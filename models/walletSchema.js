import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  balance: { type: Number, default: 0 },
  transactions: [
    {
      amount: { type: Number, required: true },
      type: { type: String, enum: ["credit", "debit"], required: true },
      description: { type: String },
      date: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });


const Wallet = mongoose.model("Wallet", walletSchema);
export default Wallet;
