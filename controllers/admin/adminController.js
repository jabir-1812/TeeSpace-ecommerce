import User from '../../models/userSchema.js'
import mongoose from 'mongoose';
import bcrypt from 'bcrypt'
import adminAccountServices from '../../services/admin services/adminAccountServices.js'


const loadLogin=(req,res)=>{
    if(req.session.admin){
        return res.redirect('/admin')
    }
    res.render('./admin/login',{title:"Admin Login",message:null})
}


const login=async (req,res)=>{
    try {
        const {email,password}=req.body;
        const admin=await adminAccountServices.findAdmin(email)
        
        if(admin){
            const passwordMatch=await adminAccountServices.comparePassword(password, admin.password)
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


export default {
    loadLogin,
    login,
    logout,
    pageError
}