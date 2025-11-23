const Status=require('../../constants/statusCodes')
const User=require('../../models/userSchema');

const customerInfo=async (req,res)=>{
    try {
        let search="";
        if(req.query.search){
            search=req.query.search;
        }
        let page=1;
        if(req.query.page){
            page=parseInt(req.query.page);
        }
        const limit=5;
        const userData=await User.find({
            isAdmin:false,
            $or:[
                {name:{$regex:".*"+search+".*",$options:"i"}},
                {email:{$regex:".*"+ search +".*",$options:"i"}}
            ]
        })
        .sort({createdOn:-1})
        .limit(limit*1)
        .skip((page-1)*limit)
        .exec();//exec()===>no problem if you don't use it
                //if we use it , it returns real Promise. May give better stack traces
                //if we don't, it return "thenable"(acts like Promise). Good enough in most real use cases.

        const count=await User.find({
            isAdmin:false,
            $or:[
                {name:{$regex:".*"+search+".*"}},
                {email:{$regex:".*"+ search +".*"}}
            ]
        }).countDocuments();
        res.render('./admin/customers/customers',{
            layout:"adminLayout",
            title:"Customers",
            data:userData,
            totalPages:Math.ceil(count/limit),
            currentPage:page,
            search:search
        })
    } catch (error) {
        
    }
}


const blockCustomer=async (req,res)=>{
    try {
        let {userId}=req.body;
        await User.updateOne({_id:userId},{$set:{isBlocked:true}});
        res.json({success:true,message:"user blocked successfully"})
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error blocking the user"})
        console.error("error blocking the user:",error)
        res.redirect('/admin/page-error')
    }
}


const unblockCustomer=async (req,res)=>{
   try {
        let {userId}=req.body;
        await User.updateOne({_id:userId},{$set:{isBlocked:false}});
        res.json({success:true,message:"user unblocked successfully"})
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error unblocking the user"})
        console.error("error unblocking the user:",error)
        res.redirect('/admin/page-error')
    }
}

module.exports={
    customerInfo,
    blockCustomer,
    unblockCustomer
}