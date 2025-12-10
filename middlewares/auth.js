const passport = require('passport');
const Status=require('../constants/statusCodes')
const User=require('../models/userSchema');



const userAuth = async (req, res, next) => {
    try {
        // 1. Check if session exists
        if (!req.session.user && !req.session?.passport.user) {
            // If it's an AJAX request, send JSON instead of redirect
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(Status.UNAUTHORIZED).json({ status: false, success:false, message: 'Login required' });
            }

            return res.redirect('/login');
        }

        // 2. Check if user exists in DB
        const userId=req.session.user || req.session?.passport.user
        const user = await User.findById(userId);
        if (!user) {
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(Status.UNAUTHORIZED).json({ status: false, message: 'User not found, Login required' });
            }
            return res.redirect('/login');
        }

        // 3. Check if user is blocked
        if (user.isBlocked) {
            if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
                return res.status(Status.UNAUTHORIZED).json({ status: false, message: 'User blocked' });
            }
            return res.redirect('/login');
        }

        // ✅ Everything is fine → allow request
        next();
    } catch (err) {
        console.log("Error in userAuth:", err);
        res.status(Status.INTERNAL_ERROR).send("Internal Server Error");
    }
};




const adminAuth = async (req, res, next) => {
    try {
        // 1. Check if session exists
        if (!req.session.admin) {
            return res.redirect('/admin/login');
        }

        // 2. Get user from DB
        const admin = await User.findById(req.session.admin);
        if (!admin) {
            return res.redirect('/admin/login');
        }

        // 3. Check if user is admin
        if (!admin.isAdmin) {
            return res.redirect('/admin/login');
        }

        // 4. Check if admin is blocked
        if (admin.isBlocked) {
            return res.redirect('/admin/login');
        }

        // ✅ Passed all checks → continue
        next();
    } catch (err) {
        console.log("Error in adminAuth:", err);
        res.status(Status.INTERNAL_ERROR).send("Internal Server Error");
    }
};




module.exports={
    userAuth,
    adminAuth
}