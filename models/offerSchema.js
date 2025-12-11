import mongoose from "mongoose";

const offerSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["category", "brand"], // distinguishes what the offer is for
    required: true,
  },
  refId: {
    type: mongoose.Schema.Types.ObjectId, // categoryId or brandId
    required: true,
    index: true, // improves lookup speed
  },
  name: {
    type: String,
    required: true, // category or brand name
  },
  percentage: {
    type: Number,
    required: true,
    min: 1,
    max: 100, // typically offer percentage is between 1–100
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  description: { type: String },
}, { timestamps: true });

const Offer=mongoose.model("Offer",offerSchema);
export default Offer;