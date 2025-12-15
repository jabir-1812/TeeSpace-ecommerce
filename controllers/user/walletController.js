import dotenv from "dotenv";
dotenv.config();
import Status from '../../constants/statusCodes.js';
import User from '../../models/userSchema.js';
import Wallet from '../../models/walletSchema.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';




const razorpay=new Razorpay({
  key_id:process.env.RAZORPAY_KEY_ID,
  key_secret:process.env.RAZORPAY_KEY_SECRET
})


const createRazorPayOrder=async(req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
		const {walletAmount}=req.body;
        if(!walletAmount)return res.status(Status.BAD_REQUEST).json({success:false,message:"Enter an amount"})
        
        const options={
            amount:walletAmount*100,
            currency:"INR"
        }
        console.log("option.amount=====>",options.amount)

        const order=await razorpay.orders.create(options);
        res.json(order)
    } catch (error) {
        console.log("walletController / createRazorPayOrder() error=====>",error);
        return res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong. Please try again later"})
    }
}

const verifyRazorpayPayment = async (req,res)=>{
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =req.body;

        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature === expectedSign) {
            res.json({ success: true, message: "Payment verified successfully" });
        } else {
            res.json({ success: false, message: "Payment verification failed" });
        }
    } catch (error) {
        console.log("verifyRazorpayPayment() error===>",error)
    }
}

// const getWallet=async (req,res)=>{
//     try {
//         const userId=req.session.user || req.session.passport?.user;
//         const userData=await User.findOne({_id:userId});

//         let userWallet=await Wallet.findOne({userId});
//         if (userWallet && userWallet.transactions) {
//             // sort in place (descending: newest → oldest)
//             userWallet.transactions.sort((a, b) => b.date - a.date);
//         }
//         if(!userWallet){
//             userWallet=await Wallet.create({
//                 userId,
//             })
//         }

//         res.render('user/wallet/wallet',{
//             title:"Wallet",
//             user:userData,
//             cartLength:null,
//             userWallet,
//             razorPayKeyId:process.env.RAZORPAY_KEY_ID
//         })
//     } catch (error) {
//         console.error("getWallet() error=====>",error);
//         res.redirect('/page-not-found')
//     }
// }

const getWallet = async (req, res) => {
    try {
        const userId = req.session.user || req.session.passport?.user;
        const userData = await User.findById(userId);

        // ✅ Pagination values
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // you can make this dynamic via req.query.limit
        const skip = (page - 1) * limit;

        // ✅ Step 1: get wallet (if not found create one)
        let userWallet = await Wallet.findOne({ userId });

        if (!userWallet) {
            userWallet = await Wallet.create({ userId });
        }

        // ✅ Step 2: paginated transactions (aggregation)
        const paginatedWallet = await Wallet.aggregate([
            { $match: { userId: userWallet.userId } },
            { $unwind: "$transactions" },
            { $sort: { "transactions.date": -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $group: {
                    _id: "$_id",
                    userId: { $first: "$userId" },
                    balance: { $first: "$balance" },
                    transactions: { $push: "$transactions" }
                }
            }
        ]);

        // ✅ If no transactions after aggregation, fallback
        const finalWallet = paginatedWallet[0] || userWallet;

        // ✅ Step 3: total count for pagination UI
        const totalTransactions = userWallet.transactions.length;
        const totalPages = Math.ceil(totalTransactions / limit);

        res.render("user/wallet/wallet", {
            title: "Wallet",
            user: userData,
            cartLength: null,
            userWallet: finalWallet,
            razorPayKeyId: process.env.RAZORPAY_KEY_ID,
            page,
            totalPages
        });

    } catch (error) {
        console.error("getWallet() error=====>", error);
        res.redirect("/page-not-found");
    }
};



const addMoney=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const {amount}=req.body;
        const userWallet=await Wallet.findOne({userId});
        
        if(!userWallet){
            userWallet=await Wallet.create({
                userId,
            })
        }
        userWallet.balance+=parseInt(amount);
        userWallet.transactions.push({
            amount:amount,
            type:"credit",
            description:'Money added'
        })

        await userWallet.save();
        res.status(Status.OK).json({success:true,message:"Money added to your wallet successfully"})
        
    } catch (error) {
        console.log("addMoney() error======>",error);
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
    }
}



export default {
    getWallet,
    createRazorPayOrder,
    verifyRazorpayPayment,
    addMoney
}