const mongoose=require('mongoose');
const {Schema}=mongoose;

const cartSchema=new Schema({
    userId:{
        type:Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    items:[{
        productId:{
            type:Schema.Types.ObjectId,
            ref:"Product",
            // required:CSSViewTransitionRule
            required:true
        },
        quantity:{
            type:Number,
            default:1
        },
        couponDiscount:{type:Number,default:0}
    }],
    appliedCoupons: [
        {
            couponId: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon" },
            code: {type:String},
            discountAmount: {type:Number},
        },  
    ],

})

const Cart=mongoose.model("Cart",cartSchema);
module.exports=Cart;