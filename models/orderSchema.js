const mongoose = require("mongoose");
const { Schema } = mongoose;
const DELIVERY_STATUS=require('../constants/deliveryStatus.enum')


const orderSchema = new Schema(
  {
    orderId: { type: String, unique: true }, 
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    shippingAddress: { type: Object, required: true },
    paymentMethod: { type: String, required: true },
    paymentStatus: { type: String, default: "Pending" }, // Paid, Pending, Failed
    razorPayOrderId:{type:String},
    razorPayPaymentId:{type:String},
    razorPayFailureReason:{type:String},
    refundStatus:{
      type:String,
      enum:["Not Initiated","Partially Refunded","Refunded","Refunded to your wallet"],
      default:null
    },
    orderStatus: {
      type: String,
      enum:Object.values(DELIVERY_STATUS), 
      default: DELIVERY_STATUS.PENDING 
    },
    cancelReason:{type:String},
    orderItems: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        categoryId: { type:Schema.Types.ObjectId, ref: "Category", required: true},
        quantity: { type: Number, required: true },
        mrp:{type:Number,required:true},
        totalMrp:{type:Number,required:true},
        offerDiscount:{type:Number,required:true,default:0},
        salePrice:{type:Number,required:true,default:0},
        totalSalePrice:{type:Number,required:true,default:0},
        couponDiscount:{type:Number,required:true, default:0},
        //total amount
        price: { type: Number, required: true },
        //if any item cancelled from the order, stroring updated & recalculated paid amount
        finalPaidAmount: { type: Number},
        //if any item cancelled from the order, stroring updated & recalculated coupon discount
        finalCouponDiscount: { type: Number},

        productName: { type: String },
        productImage: { type: String },
        itemStatus: { type: String,enum:Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.PENDING },
        cancelReason:{type:String},
        deliveredOn:{type:Date},
        //  Return-related fields
        returnReason: { type: String },       // Why user returned
        returnStatus: {
          type: String,
          enum: [
            "Requested", 
            "Approved", 
            "Pickup Scheduled",
            "Picked Up",
            "In Transit",
            "Received",
            "Refunded",
            "Replacement Shipped",
            "Rejected"
          ],
          default: null
        },
        rejectionReason:{type:String},

        returnRequestedAt: { type: Date },    // When user initiated
        returnResolvedAt: { type: Date },     // When admin approved/rejected
        refundStatus: { type: String, enum: ["Not Initiated", "Refunded","Refunded to your wallet"], default: null },
        refundedOn:{type:Date}
      }
      
    ],
    totalMrp:{type:Number,required:true},
    totalOfferDiscount:{type:Number,required:true,default:0},
    appliedCoupons:[
      {
        discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
        discountValue: { type: Number, required: true },
        minPurchase: { type: Number, default: 0 },
        maxDiscountAmount:{type:Number,default:1000}, // 🟢 category-based coupon fields
        isCategoryBased: { type: Boolean, default: false },
        applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
        excludedCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      }
    ],
    totalCouponDiscount:{type:Number,default:0},
    isCouponApplied:{type: Boolean, default:false},
    totalPrice:{type:Number,required:true},
    totalAmount: { type: Number, required: true },
    //for sales report we need actually given coupon discount, actual paid amount, actual total price of order
    //also these show the actual current order's price details after any item cancelled.
    //every time any item cancelled, these fields will be recalculate and store the actual amounts.
    finalTotalOfferDiscount:{type:Number,required:true,default:0},
    finalTotalCouponDiscount:{type:Number,default:0},
    finalTotalPrice:{type:Number,required:true},
    finalTotalAmount: { type: Number, required: true },
    refundedAmount:{type :Number, default:0},

    //  Invoice-related fields
    invoice: {
      number: { type: String }, // e.g., INV-2025-0001
      date: { type: Date },
      fileUrl: { type: String }, // optional: store generated PDF URL if you save it
      generated: { type: Boolean, default: false }, // has invoice been created?
    },
    deliveredOn:{type:Date}
  },
  { timestamps: true }
);


const Order = mongoose.model("Order", orderSchema);
module.exports=Order;
