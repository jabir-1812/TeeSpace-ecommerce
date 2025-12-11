import Status from '../../constants/statusCodes.js';
import User from '../../models/userSchema.js';
import Cart from '../../models/cartSchema.js';
import Category from '../../models/categorySchema.js';
import Product from '../../models/productSchema.js';
import Banner from '../../models/bannerSchema.js';
import Brand from '../../models/brandSchema.js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import Offer from '../../models/offerSchema.js';
import Coupon from '../../models/couponSchema.js';
import crypto from 'crypto';
import logger from '../../config/logger.js';



const pageNotFound=async (req,res) => {
    try {
        res.render("./user/page-404",{title:"Page not found"})
    } catch (error) {
        res.redirect('/page-not-found')
    }
}




const loadSignup=async(req,res)=>{
    try {
        return res.render('./user/signup',{title:"Sign Up",message:"",user:""});
    } catch (error) {
        console.log("Home page not loading:",error)
        res.status(Status.INTERNAL_ERROR).send("Server Error")
    }
}




function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, otp) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false, // <-- Add this line to ignore self-signed cert errors
      },
    });

    const info = await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Verify your account",
      text: `Your OTP is ${otp}`,
      html: `<b>Your OTP: ${otp}</b>`,
    });

    //transporter.sendMail() returns a promise
    //if the mail send successfully it prints
    //info.accepted=[ 'receiver_email@example.com' ]
    return info.accepted.length > 0;
  } catch (error) {
    console.error("Error sending email", error);
    return false;
  }
}




const signup =async(req,res)=>{
    try {
        const {name,email,phone,password,ref} =req.body;
        console.log("ref",ref)
        const user=await User.findOne({email});

        if(user){
            return res.render('./user/signup',{title:"Sign Up",message:"This email already has an account"})
        }

        const findAccounts=await User.find({phone:phone});
        if(findAccounts.length>3){
            return res.render('./user/signup',{title:"Sign Up",message:"This phone already has more than 3 account"})
        }

        const otp=generateOTP();

        //if email send successfully
        //emailSent=will be true 
        const emailSent=await sendVerificationEmail(email,otp);
        if(!emailSent){
            return res.json("email-error")
        }

        //temporarly saving the otp, name, email, phone, password in session
        //so we don't lose these data even if we render another page
        //we need to use these data to verify otp
        //we can use these data to save user,
        //if we don't save it temporarly, we may lose these data after otp verification
        req.session.userOtp=otp;
        req.session.userData={name,email,phone,password,ref};

        res.render('./user/otp-verification',{title:"OTP Verification"});
        console.log("OTP Sent:",otp)
    } catch (error) {
        console.error("sign up error:",error)
        res.redirect('/page-not-found');
    }
}

const securePassword=async (password)=>{
    try {
        const passwordHash=await bcrypt.hash(password,10)
        return passwordHash;
    } catch (error) {
        
    }
}

const verifyOtp=async(req,res)=>{
    try {
        const {otp}=req.body;

        if(otp === req.session.userOtp){
            const user=req.session.userData;
            console.log("user verifyOtp()",user)
            const passwordHash=await securePassword(user.password);

            // Check if referred by someone
            let referredByUser = null;
            if (user.ref) {
            referredByUser = await User.findOne({ referralToken: user.ref });
            }

            // Create new referral token for this new user
            const referralToken = crypto.randomBytes(8).toString("hex");

            const saveUserData=new User({
                name:user.name,
                email:user.email,
                phone:user.phone,
                password:passwordHash,
                referralToken,
                referredBy:referredByUser?._id || null

            })

            await saveUserData.save();

            // If user was referred → reward the referrer
            if (referredByUser) {
            console.log(`🎁 Reward given to: ${referredByUser.email}`);
            giveReferralCoupon(referredByUser._id)
            }

            async function giveReferralCoupon(userId) {
                // Example: generate a random coupon code
                const couponCode = "REF" + Math.floor(100000 + Math.random() * 900000);
                
                const now=new Date();
                const oneYearFromNow=new Date(now);
                oneYearFromNow.setFullYear(oneYearFromNow.getFullYear()+1);
                oneYearFromNow.setHours(0,0,0,0)

                // Save to your Coupon model (not shown here)
                await Coupon.create({
                    userId,
                    type:"referral",
                    couponCode: couponCode,
                    discountType:"percentage",
                    discountValue:10,
                    startDate:now,
                    expiryDate:oneYearFromNow,
                    maxUses:1,
                    maxDiscountAmount:1000,
                    description:"10% OFF on all orders"
                    
                });

                console.log(`✅ Coupon ${couponCode} given to user ${userId}`);
            }


            req.session.user=saveUserData._id; //saving the user id in the session
            //because after successfull registration,user details must be in the session
            // then only we let the user to go to the home page
            res.json({success:true,redirectUrl:"/"})
        }else{
            res.status(Status.BAD_REQUEST).json({success:false,message:"Invalid OTP, Please try again"})
        }
    } catch (error) {
        console.error("Error Verifying OTP",error);
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"An error occured"})
    }
}

const resendOtp=async (req,res)=>{
    try {
        const {email}=req.session.userData;
        if(!email){
            return res.status(Status.BAD_REQUEST).json({success:false,message:"Email not found in session"})
        }

        const otp=generateOTP();
        req.session.userOtp=otp;

        const emailSent=await sendVerificationEmail(email,otp);
        if(emailSent){
            console.log("Resent OTP:",otp);
            res.status(Status.OK).json({success:true,message:"OTP Resend Successfully"})
        }else{
            res.status(Status.INTERNAL_ERROR).json({success:false,message:"Failed to resend OTP. Please try again"})
        }
    } catch (error) {
    console.error("Error resending OTP",error);
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Internal Server Error. Please try again"})        
    }
}



const loadLogin=async (req,res)=>{
    try {
            return res.render('./user/login',{title:"Log in",message:"",passwordMsg:"",user:""})
    } catch (error) {
        console.log('loadLogin() error=====>',error)
        logger.error("loadLogin() error")
        res.redirect('/page-not-found')
    }
}



const login=async (req,res)=>{
    try {

        const {email,password}=req.body;
        const findUser=await User.findOne({isAdmin:0,email:email});
        
        if(!findUser){
            return res.render('./user/login',{title:"Log in",message:"User not found",passwordMsg:"",user:''})
        }

        if(findUser.isBlocked){
           return res.render('./user/login',{title:'Log in',message:'User is blocked by admin',passwordMsg:"",user:''})
        }

        const passwordMatch=await bcrypt.compare(password,findUser.password);

        if(!passwordMatch){
            return res.render('./user/login',{title:"Login",message:"",passwordMsg:"Incorrect Password",user:''})
        }

        req.session.user=findUser._id;
        // req.session.user=findUser;
        res.redirect('/')

    } catch (error) {
        console.log("login error:",error)
        res.render('./user/login',{title:"Login",message:"Login failed, Please try again later",passwordMsg:"",user:''})
    }
}


const loadHomepage=async (req,res)=>{ 
    try {
        //banner
        const today=new Date().toISOString();
        const findBanner=await Banner.find({
            startDate:{$lt:new Date(today)},
            endDate:{$gt:new Date(today)}
        })

        //offers carousel
        const categoryOffers=await Offer.find({type:"category"})
        const brandOffers=await Offer.find({type:"brand"})
        const coupons=await Coupon.find({
            startDate:{$lt:new Date(today)},
            expiryDate:{$gt:new Date(today)},
            isActive:true,
            type:{$ne:"referral"}
        })


        const userId=req.session.user || req.session.passport?.user;

        const categories=await Category.find({isDeleted:false});//listing unblocked categories
        let productData=await Product.find(
            {
                isBlocked:false,//listing unblocked products 
                category:{$in:categories.map(category=>category._id)} //it is like==> find({category:{in:[categoryId1, categoryId2,....]
            }
        )

        productData.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
        productData=productData.slice(0,8);


        if(userId){
            const userData=await User.findOne({_id:userId});
            const userCart=await Cart.findOne({userId:userId});
            // console.log("userCart======>",userCart)
            if(userData.isBlocked) return res.render('./user/3home',{
                title:"Home",
                user:"",
                products:productData,
                cartLength:'',
                banner:findBanner || [],
                categoryOffers,
                brandOffers,
                coupons
            });
            logger.info("Home route was called")
            return res.render('./user/3home',{
                title:"Home",
                user:userData,
                products:productData,
                banner:findBanner || [],
                cartLength: userCart ? userCart.items.length : 0,
                categoryOffers,
                brandOffers,
                coupons
            })
        }else{
            return res.render('./user/3home',{
                title:"Home",
                user:"",
                products:productData,
                banner:findBanner || [],
                cartLength:"",
                categoryOffers,
                brandOffers,
                coupons
            });
        }
    } catch (error) {
        console.log('loadHomepage() error:',error)
        logger.error("loadHomepage() error")
        res.redirect('/page-not-found')
    }
}





// const logout=async (req,res)=>{
//     try {
//         // console.log("session before logout:",req.session);
        
//         req.session.destroy((err)=>{
//             if(err){
//                 console.log("Session destruction error:",err.message);
//                 return res.redirect('/page-not-found')
//             }
//             // console.log("session after logout:",req.session)
//             return res.redirect('/login')
//         })
//     } catch (error) {
//         console.log("logout() error:",error)
//         res.redirect('/page-not-found')
//     }
// }


const logout=async (req,res)=>{
    try {
        delete req.session.user;
        res.redirect('/login')
    } catch (error) {
        console.log("logout() error:",error)
        res.redirect('/page-not-found')
    }
}




const loadShoppingPage = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const user = await User.findById(userId);

    const userCart = await Cart.findOne({ userId: user });
    const categories = await Category.find({ isDeleted: false });
    const brands = await Brand.find({ isBlocked: false });

    let { search = "", sort = "", categoryIds = [], brandIds = [], minPrice = "", maxPrice = "" } = req.query;

    // Ensure arrays
    if (!Array.isArray(categoryIds)) categoryIds = [categoryIds];
    if (!Array.isArray(brandIds)) brandIds = [brandIds];

    let filter = { isBlocked: false };

    if (search.trim().length > 0) {
      filter.productName = { $regex: search, $options: "i" };
    }

    if (categoryIds.length > 0 && categoryIds[0] !== "") {
      filter.category = { $in: categoryIds };
    }

    if (brandIds.length > 0 && brandIds[0] !== "") {
      filter.brand = { $in: brandIds };
    }

    if (minPrice || maxPrice) {
      filter.salePrice = {};
      if (minPrice) filter.salePrice.$gte = parseFloat(minPrice);
      if (maxPrice) filter.salePrice.$lte = parseFloat(maxPrice);
    }

    // Sorting logic
    let sortOption = {};
    if (sort === "price-asc") sortOption.salePrice = 1;
    if (sort === "price-desc") sortOption.salePrice = -1;
    if (sort === "name-asc") sortOption.productName = 1;
    if (sort === "name-desc") sortOption.productName = -1;

    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const skip = (page - 1) * limit;

    // Fetch paginated products
    const products = await Product.find(filter)
      .sort(sortOption)
      .populate("brand")
      .skip(skip)
      .limit(limit);

    // FIXED: countDocuments(filter)
    const totalProducts = await Product.countDocuments(filter);

    const totalPages = Math.ceil(totalProducts / limit);

    res.render("./user/2shop", {
      title: "Shopping page",
      user,
      categories,
      categoryIds,
      brands,
      brandIds,
      minPrice,
      maxPrice,
      products,
      currentPage: page,
      totalPages,
      search,
      sort,
      cartLength: userCart ? userCart.items.length : 0
    });

  } catch (error) {
    console.log("loadShoppingPage error:", error);
    res.redirect("/page-not-found");
  }
};




const filterProduct = async (req,res)=>{
    try {
        // const user=req.session.user;
        const user=req.session.user || req.session.passport?.user;
        const category=req.query.category;
        const brand=req.query.brand;

        const findCategory=category ? await Category.findOne({_id:category}) : null;
        const findBrand=brand ? await Brand.findOne({_id:brand}) : null;
        // const brands=await Brand.find({}).lean();
        const brands=await Brand.find({isBlocked:false})
        const query={
            isBlocked:false,
            quantity:{$gt:0}
        }

        if(findCategory){
            query.category=findCategory._id;
        }

        if(findBrand){
            query.brand=findBrand._id;
        }

        let findProducts=await Product.find(query).populate('brand').lean();
        findProducts.sort((a,b)=>new Date(b.createdOn)-new Date(a.createdOn));

        const categories=await Category.find({isDeleted:false})

        let itemsPerPage=6;
        let currentPage=parseInt(req.query.page) || 1;
        let startIndex=(currentPage-1)*itemsPerPage;
        let endIndex=startIndex+itemsPerPage;
        let totalPages=Math.ceil(findProducts.length/itemsPerPage);
        const currentProduct=findProducts.slice(startIndex,endIndex);

        let userData=null;
        if(user){
            userData=await User.findOne({_id:user});
            if(userData){
                const searchEntry={
                    category:findCategory ? findCategory._id : null,
                    brand:findBrand ? findBrand._id : null,
                    searchedOn:new Date()
                }
                userData.searchHistory.push(searchEntry);
                await userData.save();
            }
        }

        req.session.filteredProducts=currentProduct;

        res.render("./user/shop",{
            title:"Shopping page",
            user:userData,
            products:currentProduct,
            category:categories,
            brand:brands,
            totalPages,
            currentPage,
            selectedCategory:category || null,
            selectedBrand:brand || null
        })
    } catch (error) {
     console.log('filterProduct error:',error);
     res.redirect('/page-not-found')   
    }
}

const filterByPrice=async (req,res)=>{
    try {
        // const user=req.session.user;
        const user=req.session.user || req.session.passport?.user;
        const userData=await User.findOne({_id:user});
        const brands=await Brand.find({}).lean();
        const categories=await Category.find({isDeleted:false}).lean();

        let findProducts=await Product.find({
            salePrice:{$gt:req.query.gt,$lt:req.query.lt},
            isBlocked:false,
            quantity:{$gt:0}
        }).populate('brand').lean();

        findProducts.sort((a,b)=>new Date(b.createdOn)-new Date(a.createdOn));
        let itemsPerPage=6;
        let currentPage=parseInt(req.query.page) || 1;
        let startIndex=(currentPage-1)*itemsPerPage;
        let endIndex=startIndex+itemsPerPage;
        let totalPages=Math.ceil(findProducts.length/itemsPerPage);
        const currentProduct=findProducts.slice(startIndex,endIndex)
        res.render("./user/shop",{
            title:"Shopping Page",
            user:userData,
            products:currentProduct,
            category:categories,
            brand:brands,
            totalPages,
            currentPage
        })

    } catch (error) {
        console.log("filterByPrice error:",error);
        res.redirect('/page-not-found')
    }
}


const searchProducts=async (req,res)=>{
    try {
        // const user=req.session.user;
        const user=req.session.user || req.session.passport?.user;
        const userData=await User.findOne({_id:user});

        let search=req.body.query;
        
        const brands=await Brand.find({isBlocked:false}).lean();
        const categories=await Category.find({isDeleted:false}).lean();
        const categoryIds=categories.map(category=>category._id.toString());
        let searchResult=[];

        searchResult=await Product.find({
            productName:{$regex:".*"+search+".*",$options:"i"},
            isBlocked:false,
            quantity:{$gt:0},
            category:{$in:categoryIds}
        }).populate('brand')

        searchResult.sort((a,b)=>new Date(b.createdOn)-new Date(a.createdOn));
        let itemsPerPage=6;
        let currentPage=parseInt(req.query.page) || 1;
        let startIndex=(currentPage-1)*itemsPerPage;
        let endIndex=startIndex+itemsPerPage;
        let totalPages=Math.ceil(searchResult.length/itemsPerPage)
        const currentProduct=searchResult.slice(startIndex,endIndex);

        res.render('./user/shop',{
            title:"Shopping Page",
            user:userData,
            products:currentProduct,
            category:categories,
            brand:brands,
            totalPages,
            currentPage,
            count:searchResult.length,
        })
    } catch (error) {
        console.log("searchProducts error:",error)
        res.redirect('/page-not-found')
    }
}

export default {
    loadHomepage,
    pageNotFound,
    loadSignup,
    signup,
    verifyOtp,
    resendOtp,
    loadLogin,
    login,
    logout,
    loadShoppingPage,
    filterProduct,
    filterByPrice,
    searchProducts
}
