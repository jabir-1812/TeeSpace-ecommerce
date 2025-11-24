const User=require('../../models/userSchema');
const mongoose=require('mongoose');
const bcrypt=require('bcrypt');


const loadLogin=(req,res)=>{
    if(req.session.admin){
        return res.redirect('/admin')
    }
    res.render('./admin/login',{title:"Admin Login",message:null})
}


const login=async (req,res)=>{
    try {
        const {email,password}=req.body;
        // console.log(`email:${email}
        //     password:${password}`)
        const admin=await User.findOne({email,isAdmin:true});
        // console.log("admin=====>",admin)
        
        if(admin){
            // console.log("if case worked=====")
            const passwordMatch=await bcrypt.compare(password,admin.password);
            if(passwordMatch){
                req.session.admin=admin._id;
                return res.redirect('/admin')
            }else{
                return res.render('./admin/login',{title:"Admin Login",message:"email or password do not match"})
            }
        }else{
            return res.render('./admin/login',{title:"Admin Login",message:"admin not found"})
        }
    } catch (error) {
    console.log("Login error:",error)
    return res.redirect('/admin/page-error')        
    }
}



// const logout=async (req,res)=>{
//     try {
//         req.session.destroy(err=>{
//             if(err){
//                 console.log("Error destroying session:",err)
//                 return res.redirect('/admin/page-error')
//             }
//             res.redirect('/admin/login')
//         })
//     } catch (error) {
//         console.log("Unexpected error during logout,",error)
//         res.redirect('/admin/page-error')
//     }
// }

const logout=async (req,res)=>{
    try {
        delete req.session.admin;
        res.redirect('/admin/login')
    } catch (error) {
        console.log("Unexpected error during logout,",error)
        res.redirect('/admin/page-error')
    }
}


const pageError=async (req,res)=>{
    res.render('./admin/page-error',{title:"Page not found"})
}


module.exports={
    loadLogin,
    login,
    logout,
    pageError
}