import dotenv from "dotenv";
dotenv.config();
import Status from '../../constants/statusCodes.js';
import StatusCode from '../../constants/statusCodes.js';
import User from '../../models/userSchema.js';
import Address from '../../models/addressSchema.js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import Coupon from '../../models/couponSchema.js';
import sharp from 'sharp';
import cloudinary from '../../config/cloudinary.js';


function generateOTP() {
  const digits = "1234567890";
  let otp = "";
  for (let i = 0; i < 6; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}


const sendVerificationEmail = async (email, otp) => {
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
      }
    });

    const mailOptions = {
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Your OTP for password reset",
      text: `Your OTP is ${otp}`,
      html: `<b><h4>Your OTP:${otp}</h4><br></b>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email", error);
    return false;
  }
};

const securePassword=async (password)=>{
    try {
        const passwordHash=await bcrypt.hash(password,10);
        return passwordHash;
    } catch (error) {
        
    }
}



const getForgotPasswordPage = async (req, res) => {
  try {
    res.render("./user/forgotPassword-enterEmail", {
      title: "Forgot Password",
      user: "",
      message:"",
      user:""
    });
  } catch (error) {
    res.redirect("/page-not-found");
  }
};



const verifyEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const findUser = await User.findOne({ email: email });
    if (findUser) {
      const otp = generateOTP();
      const emailSent = await sendVerificationEmail(email, otp);
      if (emailSent) {
        req.session.userOtp = otp;
        req.session.email = email;
        res.status(Status.OK).json({success:true,message:"Email verified",redirectUrl:'/forgot-password/email-otp-verification'})
        console.log("OTP:", otp);
      } else {
        res.json({
          success: false,
          message: "Failed to send OTP. Please try again",
        });
      }
    } else {
      res.status(404).json({success:false,message:"User with this email does not exist"})
    }
  } catch (error) {
    console.log("error:",error)
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"});
  }
};

const getEmailOtpVerficationPage = async (req,res)=>{
  try {
    if(!req.session.userOtp || !req.session.email){
      console.log("no otp in session.")
      return res.redirect('/page-not-found')
    }
    if(req.url.includes('forgot-password')){
        res.render('./user/forgotPassword-emailOtpVerfication',{
        title:"Email OTP verfication",
        user:""
      })
    }
    if(req.url.includes('change-email')){
        res.render('./user/changeEmail-otpVerification',{
        title:"Email OTP verfication",
        user:"",
        cartLength:""
      })
    }
    
  } catch (error) {
    console.log("getEmailOtpVerificationPage() error=====>",error)
    res.redirect('/page-not-found')
  }
}


const verifyForgotPasswordOtp=async (req,res)=>{
    try {
        console.log('verify Forgot Password otp has started')
        const enteredOtp=req.body.otp;
        if(enteredOtp===req.session.userOtp){
            res.json({success:true,redirectUrl:'/reset-password'});
        }else{
            res.json({success:false,message:"OTP not matching"})
        }
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"An error occured. Please try again"});
    }
}


const getResetPasswordPage=async (req,res)=>{
    try {
        res.render('./user/reset-password',{title:"Reset password",user:''});
    } catch (error) {
        res.redirect('/page-not-found')
    }
}



const resendOtp=async (req,res)=>{
    try {
        const otp=generateOTP();
        req.session.userOtp=otp;
        const email=req.session.email;
        console.log("Resending OTP to email:",email);
        const emailSent=await sendVerificationEmail(email,otp);
        if(emailSent){
            console.log("Resend OTP:",otp);
            res.status(Status.OK).json({success:true,message:"Resend OTP successful"});
        }else{
          res.status(Status.OK).json({success:false,message:"OTP not sent, Please try again"})
        }
    } catch (error) {
        console.error('Error in resend OTP:',error);
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Internal server error"})
    }
}




const postNewPassword=async (req,res)=>{
    try {
        const {password1,password2}=req.body;
        const userId=req.session.user || req.session.passport?.user;
        if(password1===password2){
            const passwordHash=await securePassword(password1);
            await User.updateOne(
                {_id:userId},
                {$set:{password:passwordHash}}
            )
            res.status(Status.OK).json({success:true,message:"Password has reset successfully."})
        }else{
            res.status(404).json({success:false,message:'Password do not match'})
        }
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"})
    }
}




const userProfile= async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);
    // const addressData=await Address.findOne({userId})

    res.render('./user/profile/2profile',{
      title:"Profile",
      user:userData,
      cartLength:''
    })

  } catch (error) {
    console.log("userProfile() error:",error);
    res.redirect('/page-not-found')
  }
}



// const changeProfilePicture = async (req,res)=>{
//   try {
//     // const imageUrl=`/uploads/user profile pictures/${req.file.filename}`
//     const userId=req.session.user || req.session.passport?.user;
//     // Cloudinary automatically adds a `path` (URL) in req.file
//     const user=await User.findOne({_id:userId})
//     if(!user) return res.status(Status.INTERNAL_ERROR).json({message:"user not found"})

//     if(user.profilePicture && user.profilePicture.public_id){
//       try {
//         await cloudinary.uploader.destroy(user.profilePicture.public_id);
//         console.log("Old image deleted from cloudinary")
//       } catch (error) {
//         console.error("Failed to delete old image from cloudinary=====error=====",error)
//       }
//     }
//     user.profilePicture={
//       url:req.file.path,
//       public_id:req.file.filename
//     };
//     await user.save();
//     res.json({success:true})
//   } catch (error) {
//     console.error("changeProfilePicture() error:",error);
//     res.status(Status.INTERNAL_ERROR).json({ success: false, message: 'Upload failed' });
//   }
// }

const changeProfilePicture=async(req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;

    const user=await User.findOne({_id:userId})
    if(!user) return res.status(Status.INTERNAL_ERROR).json({message:"user not found"})

    if(req.file){
        let processedBuffer;
        try {
          processedBuffer=await sharp(req.file.buffer)
            .resize(500,500, {fit:"cover"})
            .toFormat("webp")
            .webp({quality:85})
            .toBuffer();
        } catch (error) {
          return res.status(Status.INTERNAL_ERROR).json({success:false,message:"Failed to process the image",error:error.message})     
        }

        //upload new image to cloudinary first
        const uploadNewProfilePicture=()=>{
            return new Promise((resolve,reject)=>{
                cloudinary.uploader.upload_stream(
                    {folder:"user_profile_pictures",format:"webp"},
                    (error,result)=>{
                        if(error)return reject(error);
                        resolve(result)
                    }
                ).end(processedBuffer)
            })
        };

        let newProfilePicture;
        try {
            newProfilePicture=await uploadNewProfilePicture();
        } catch (error) {
            return res.status(Status.INTERNAL_ERROR).json({success:false,message:"Failed to upload new profile picture",error:error.message})
        }

        //delete old profile picture from cloudinary(after success upload)
        if(user.profilePicture && user.profilePicture.public_id){
            try {
                await cloudinary.uploader.destroy(user.profilePicture.public_id)
            } catch (error) {
                console.error("Old profile picture delete failed:",error);
                //not a critical failure, don't return error
            }
        }

        //update db
        user.profilePicture.url=newProfilePicture.secure_url;
        user.profilePicture.public_id=newProfilePicture.public_id;
    }

    await user.save();
    return res.json({success:true, message:"User profile picture updated successfully"})
    
  } catch (error) {
    console.error("changeProfilePicture() error:",error);
    res.status(Status.INTERNAL_ERROR).json({ success: false, message: 'Something went wrong' });
  }
}




const removeProfilePicture = async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const user=await User.findOne({_id:userId})

    if(user.profilePicture && user.profilePicture.public_id){
      try {
        await cloudinary.uploader.destroy(user.profilePicture.public_id);
        console.log("Old image deleted from cloudinary")
      } catch (error) {
        console.error("Failed to delete old image from cloudinary=====error=====",error)
      }
      user.profilePicture={url:null,public_id:null};
      await user.save();
    }
    res.json({success:true, message:"Profile picture removed"})
  } catch (error) {
    console.log("removeProfilePicture() error==========>",error)
    res.status(Status.INTERNAL_ERROR).json({message:"something went wrong"})
  }
}


const changeUsername= async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({success:false,message:"User not found"});

    const {username}=req.body;
    await User.findByIdAndUpdate(userId,{name:username});
    res.status(Status.OK).json({success:true,username:username})
  } catch (error) {
    console.log("changeUsername() error====>",error);
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
  }
}

const changePhoneNumber= async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const user =await User.findById(userId)
    if(!user) return res.status(404).json({success:false,message:"User not found"});

    const {phone}=req.body;
    await User.findByIdAndUpdate(userId,{phone:phone});
    res.status(Status.OK).json({success:true,phone:phone})
  } catch (error) {
    console.log("changePhoneNumber() error====>",error);
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
  }
}







const loadChangeEmailPage=async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);

    res.render('./user/changeEmail-enterCurrentEmail',{
      title:"Change Email",
      user:userData,
      message:"",
      cartLength:userData.cart.length
    })
  } catch (error) {
    console.log("laodChangeEmailPage() error:",error)
    res.redirect('/page-not-found')
  }
}

const verifyCurrentEmail=async (req,res)=>{
  try {

    const userId=req.session.user || req.session.passport?.user;

    const {email}=req.body;
    const userExists=await User.findOne({email});

    if(userExists){
      const otp=generateOTP();
      const emailSent=await sendVerificationEmail(email,otp);
      if(emailSent){
        req.session.userOtp=otp;
        req.session.email=email;

        res.status(Status.OK).json({success:true,message:`OTP has been sent to your email-id: ${email}`,redirectUrl:'/change-email/verify-email-otp'})
        console.log("Email sent:",email);
        console.log('OTP:',otp)
      }else{
        res.status(Status.OK).json({success:false,message:'An error occured while sending mail'})
      }
    }else{
      res.status(404).json({success:false,message:"User with this email does not exist"})
    }
  } catch (error) {
    console.log("changeEmail() error:",error)
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"})
  }
}


const verifyEmailOtp =async (req,res)=>{
  try {
    const enteredOtp=req.body.otp;
    console.log("entered otp====>",enteredOtp)
    if(enteredOtp===req.session.userOtp){
      res.status(Status.OK).json({success:true,message:"OTP verified",redirectUrl:'/change-email/enter-new-email'})
    }else{
      res.status(Status.OK).json({success:false,message:"OTP is not matching"})
    }
  } catch (error) {
    console.log("verifyEmailOtp() error:",error)
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"})
  }
}


const getUpdateEmailPage=async(req,res)=>{
  try {
    if(!req.session.userOtp || !req.session.email){
      console.log("No OTP or Email found in session")
      return res.redirect('/page-not-found')
    }

    res.render('user/changeEmail-enterNewEmail',{
      title:"",
      user:"",
      cartLength:""
    })
  } catch (error) {
    console.log("getUpdateEmailPage() error====>",error)
    res.redirect('/page-not-found')
  }
}
const updateEmail=async (req,res)=>{
  try {
    const newEmail=req.body.newEmail;
    const userId=req.session.user;
    await User.findByIdAndUpdate(userId,{email:newEmail});
    res.status(Status.OK).json({success:true,message:"Email updated successfully",redirectUrl:'/user-profile'})
  } catch (error) {
    console.log("updateEmail() error:",error);
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"})
  }
}

const laodChangePasswordPage= async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);
    res.render('./user/changePassword-enterCurrentPassword',{
      title:"Change password",
      user:userData,
      cartLength:userData.cart.length
    })
  } catch (error) {
    console.log("changePassword() error:",error);
    res.redirect('/page-not-found')
  }
}


const verifyCurrentPassword=async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);

    if(!userData){
      return res.status(404).json({success:false,message:"User not found."})
    }

    const {password}=req.body;
    const passwordMatch=await bcrypt.compare(password,userData.password);

    if(!passwordMatch){
      return res.status(404).json({success:false,message:"Incorrect Password"})
    }
    return res.status(Status.OK).json({success:true,message:"Password matching, success."})

  } catch (error) {
    console.log("changePassword() error:",error)
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"An error occured. Please try again later"})
  }
}

const verifyChangePasswordOtp=async (req,res)=>{
  try {
    const enteredOtp=req.body.otp;
    if(enteredOtp===req.session.userOtp){
      res.json({success:true,redirectUrl:'/reset-password'})
    }else{
      res.json({success:false,message:"OTP not matching"})
    }
  } catch (error) {
    console.log("verifyChangePasswordOtp() error:",error)
    res.redirect('/page-not-found')
  }
}

const loadAddAddressPage =async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);

    res.render('./user/profile/address/add-address',{
      title:"Add Address",
      user:userData,
      cartLength: userData.cart.length
    })
  } catch (error) {
    console.log("loadAddAddressPage() error:",error)
    res.redirect('/page-not-found');
  }
}


const showAddresses=async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId);
    const addressData=await Address.findOne({userId})

    res.render('./user/profile/address/addresses',{
      title:"Addresses",
      user:userData,
      userAddress:addressData,
      cartLength:""
    })
  } catch (error) {
    console.log('showAddresses() error===>',error);
    res.redirect('/page-not-found')
  }
}









const addAddress=async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findOne({_id:userId});
    // console.log(req.body)
    const {addressType,name,city,landMark,state,pincode,phone,altPhone}=req.body;
    const userAddress=await Address.findOne({userId:userData._id});
    if(!userAddress){
      const newAddress=new Address({
        userId:userData._id,
        address:[{addressType,name,city,landMark,state,pincode,phone,altPhone}]
      })
      await newAddress.save()
      return res.status(Status.OK).json({success:true,message:"New address added successfully"})
    }else{
      userAddress.address.push({addressType,name,city,landMark,state,pincode,phone,altPhone})
      await userAddress.save();
      return res.status(Status.OK).json({success:true,message:"New address added successfully"})
    }
  } catch (error) {
    console.log("addAddress() error");
    console.log("addAddress() error,Error adding address",error);
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
  }
}








const loadEditAddressPage=async (req,res)=>{
  try {
    const addressId=req.query.id;
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findOne({_id:userId});
    const currentAddress=await Address.findOne({
        userId,
        "address._id":addressId
    });

    if(!currentAddress){
      return res.redirect('/page-not-found')
    }

    const addressData=currentAddress.address.find((item)=>{
      return item._id.toString()===addressId.toString();
    })

    if(!addressData){
      return res.redirect('/page-not-found')
    }

    res.render('user/profile/address/edit-address',{
      title:"Edit Address",
      address:addressData,
      user:userData,
      cartLength:userData.cart.length
    })
  } catch (error) {
    console.log("loadEditAddressPage() error:",error)
    res.redirect('/page-not-found')
  }
}







const editAddress=async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const {addressId,addressType,name,city,landMark,state,pincode,phone,altPhone}=req.body;

    const findAddress=await Address.findOne({userId,'address._id':addressId});

    if(!findAddress){
      return res.status(404).json({success:false,message:"Address not found"})
    }

    await Address.updateOne(
      {'address._id':addressId},
      {$set:{
        "address.$":{
          addressType:addressType,
          name:name,
          city:city,
          landMark:landMark,
          state:state,
          pincode:pincode,
          phone:phone,
          altPhone:altPhone
        }
      }}
    )

    return res.status(Status.OK).json({success:true,message:"Address has been updated"})
  } catch (error) {
    console.log("editAddress() error:",error)
    return res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
  }
}










const deleteAddress=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const {addressId}=req.body;
        const findAddress=await Address.findOne({userId,"address._id":addressId})
        if(!findAddress){
            return res.status(404).json({success:false,message:'Address not found'})
        }

        await Address.updateOne(
            {"address._id":addressId},
            {
                $pull:{
                    address:{
                        _id:addressId,
                    }
                }
            }
        )
        return res.status(Status.OK).json({success:true,message:"Address has been deleted successfully"})
    } catch (error) {
        console.log("deleteAddress() error:",error)
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong, Please try later"})
    }
}









const markDefaultAddress=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const {addressId}=req.body;

        const userAddress=await Address.findOne({userId})
        if(!userAddress){
            return res.status(StatusCode.BAD_REQUEST).json({message:"Address not found"})
        }

        await Address.updateOne(
            { userId, "address._id": addressId },
            { $set: { hasDefaultAddress: true, "address.$.isDefault": true } }
        );

        await Address.updateOne(
            { userId },
            {
                $set: { "address.$[elem].isDefault": false }
            },
            {
                arrayFilters: [{ "elem._id": { $ne: addressId } }]
            }
        );

        
        return res.json({success:true})

    } catch (error) {
        console.error("markDefaultAddress() error == ",error)
        res.status(StatusCode.INTERNAL_ERROR).json({message:"Something went wrong",error})
    }
}





const getReferralCoupons=async(req,res)=>{
  try {
      const userId=req.session.user || req.session.passport?.user;
      const userData=await User.findById(userId);

      const referralCoupons=await Coupon.find({userId})

      res.render('./user/profile/referral-coupons/referral-coupons',{
        title:"Referral Rewards",
        user:userData,
        referralCoupons,
        cartLength:''
      })

  } catch (error) {
    console.error("getReferralCoupons() error====>",error)
    res.redirect('/page-not-found')
  }
}



export default {
  getForgotPasswordPage,
  verifyEmail,
  verifyForgotPasswordOtp,
  getEmailOtpVerficationPage,
  getResetPasswordPage,
  resendOtp,
  postNewPassword,
  userProfile,
  changeProfilePicture,
  removeProfilePicture,
  changeUsername,
  changePhoneNumber,
  loadChangeEmailPage,
  verifyCurrentEmail,
  verifyEmailOtp,
  getUpdateEmailPage,
  updateEmail,
  laodChangePasswordPage,
  verifyCurrentPassword,
  verifyChangePasswordOtp,
  showAddresses,
  loadAddAddressPage,
  addAddress,
  loadEditAddressPage,
  editAddress,
  deleteAddress,
  markDefaultAddress,
  getReferralCoupons
};