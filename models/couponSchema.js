import mongoose from 'mongoose';
const {Schema}=mongoose;

const couponSchema = new mongoose.Schema({
  couponCode: { type: String, required: true, uppercase:true, unique: true, trim:true },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true },
  minPurchase: { type: Number, default: 0 },
  maxDiscountAmount:{type:Number,default:1000},
  startDate:{type:Date,required:true},
  expiryDate: { type: Date, required: true },
  maxUses: { type: Number, default: 1 }, // total uses allowed
  usedCount: { type: Number, default: 0 },
  usersUsed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // track who used it
  isActive: { type: Boolean, default: true },
  description:{type:String},
  type:{type:String},
  userId:{type:mongoose.Schema.Types.ObjectId, ref:"User"},

  // 🟢 category-based coupon fields
  isCategoryBased: { type: Boolean, default: false },
  applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  excludedCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
});

const Coupon=mongoose.model("Coupon",couponSchema);
export default Coupon