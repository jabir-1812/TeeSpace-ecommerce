import dotenv from "dotenv";
dotenv.config();
import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';//imports google OAuth
                                                    //gets the strategy class to tell Passport how to login
import User from '../models/userSchema.js';

import crypto from 'crypto';
import giveReferralCoupon from '../utils/giveReferralCoupon.js';

// console.log("CLIENT_ID:", process.env);

//tells passport to use google login strategy
// we are creating new google strategy
passport.use(new GoogleStrategy({                   
    clientID:process.env.GOOGLE_CLIENT_ID,      //we tell google who we are     
    clientSecret:process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:'/auth/google/callback',//redirect route after successful user login
    passReqToCallback:true        //allows access to req in callback 
},
async (req,accessToken,refreshToken,profile,done)=>{    //profile=>user info from google
    try {         
        let ref=null;
        if(req.query.state){
            const parsedState=JSON.parse(req.query.state);
            ref=parsedState.ref;
        }                                  
        //done()function tells passport "i've finished logging the user"
        let user=await User.findOne({googleId:profile.id});
        if(user){
            return done(null,user);     //null=no error, everything ok
        }else{            
            let referrdByUser=null;
            if(ref){
                referrdByUser=await User.findOne({referralToken:ref});
            }              
            //returning user=>user info from google to passport
            user=new User({             //if user not exist, we create user.
                name:profile.displayName,
                email:profile.emails[0].value,
                googleId:profile.id,
                referralToken:crypto.randomBytes(8).toString('hex'),
                referredBy:referrdByUser ? referrdByUser._id : null,
            });
            await user.save();

            if(referrdByUser){
                await giveReferralCoupon(referrdByUser._id);
                console.log(`Referral reward given to:${referringUser.email}`);
            }

            return done(null,user);         //returning the user info to passport
        }
    } catch (error) {
        console.error('Google Strategy Error:', error);
        return done(error,null)
    }
}

))



passport.serializeUser((user,done)=>{
    done(null,user.id)  //saving the user.id in the session
});

passport.deserializeUser((id,done)=>{   //it checks the session
    User.findById(id)   //it grabs the user info from session
    .then(user=>{
        done(null,user)
    })
    .catch(err=>{
        done(err.null) // error=runs if there is no session 
    })
})




export {passport}