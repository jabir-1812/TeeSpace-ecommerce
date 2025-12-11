import mongoose from 'mongoose'
const {Schema}=mongoose;

const brandSchema =new Schema({
    brandName:{
        type:String,
        unique:true,
        required:true,
        validate:{
            validator:async function (value) {
                const count=await this.constructor.countDocuments({
                    brandName:{$regex:new RegExp(`^${value}$`,'i')},
                    _id:{$ne:this._id}
                })
                return count===0;
            },
            message:"Brand name already exists(case insensitive)"
        }
    },
    brandImage: { type: String, required: true },      // Cloudinary URL
    cloudinaryId: { type: String, required: true },    // needed for future delete/update
    isBlocked:{
        type:Boolean,
        default:false
    },
    createdAt:{
        type:Date,
        default:Date.now
    },
    offer:{
        type:Number,
        default:0
    },
    offerStartDate:{type:Date},
    offerEndDate:{type:Date},
    offerDescription:{type:String}
})

const Brand=mongoose.model("Brand",brandSchema);
export default Brand;