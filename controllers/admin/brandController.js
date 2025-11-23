const Status=require('../../constants/statusCodes')
const path=require('path')
const fs=require('fs')
const sharp=require("sharp")
const cloudinary = require('../../config/cloudinary');
const Brand=require('../../models/brandSchema');
const Product=require('../../models/productSchema');
const Offer = require('../../models/offerSchema')



const loadAllBrands=async (req,res)=>{
    try {
        const ITEMS_PER_PAGE=5;
        const page=parseInt(req.query.page) || 1;
        const search = req.query.search || '';

        const totalBrands=await Brand.countDocuments({brandName:{$regex:".*"+search+".*",$options:"i"}})
        const totalPages=Math.ceil(totalBrands/ITEMS_PER_PAGE);
        const brands=await Brand.find({brandName:{$regex:".*"+search+".*",$options:"i"}})
        .sort({createdAt:-1})
        .skip((page-1)*ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE)

        const products=await Product.aggregate([{$group:{_id:"$brand",products:{$sum:1}}}])

        for(const brand of brands){
            for(const p of products){
                if(brand._id.toString()===p._id.toString()){
                    brand.products=p.products;
                }
            }
        }


        res.render('./admin/brand/3brands',{
            layout:"adminLayout",
            title:"Brands",
            brands,
            products,
            totalBrands,
            totalPages,
            search,
            currentPage:page

        })
    } catch (error) {
        console.log("error in loadAllBrands:",error);
        res.redirect('/admin/page-error');
    }
}

const loadAddBrandPage=async (req,res)=>{
    try {
        res.render('./admin/brand/2add-brand',{
            layout:"adminLayout",
            title:"Add brand",
            error:null,
            formData:{}
        })
    } catch (error) {
        console.log("error in loading the add-brand page:",error)
        res.redirect('/admin/page-error')
    }
}




const addBrand=async (req,res)=>{
    try {
        const { brandName } = req.body;

        if (!brandName || !req.file) {
            return res.status(Status.BAD_REQUEST).json({
                success: false,
                message: "Brand name and logo are required"
            });
        }

        const findBrand=await Brand.findOne({brandName:{$regex:`^${brandName}$`,$options:"i"}})
        if(findBrand) return res.status(Status.BAD_REQUEST).json({message:"Brand name exists"})

        // 2️⃣ Use SHARP to resize & compress BEFORE uploading
        let processedBuffer;
        try {
            processedBuffer = await sharp(req.file.buffer) // from multer memory storage
                .resize(500, 500, { fit: "cover" })  // ✅ crop center
                .toFormat("webp")                    // ✅ convert to webp
                .webp({ quality: 85 })               // ✅ compression
                .toBuffer();
        } catch (err) {
            console.error("Sharp Error:", err);
            return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Image processing failed",
                error: err.message
            });
        }

        // ✅ Upload image to Cloudinary using buffer
        const uploadToCloudinary = () => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                    folder: "brand_logos"   // ✅ your folder name
                    },
                    (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                    }
                );
                stream.end(processedBuffer);
            });
        };

        let uploadResult;
        try {
            uploadResult = await uploadToCloudinary();
        } catch (cloudError) {
            console.error("Cloudinary Upload Error:", cloudError);
            return res.status(Status.INTERNAL_ERROR).json({
            success: false,
            message: "Failed to upload image to Cloudinary",
            error: cloudError.message
            });
        }

        // ✅ Save brand to DB
        const brand = await Brand.create({
            brandName,
            brandImage: uploadResult.secure_url,
            cloudinaryId: uploadResult.public_id
        });

        return res.json({
            success: true,
            message: "Brand added successfully",
        });

        
    } catch (error) {
        console.error(err);
        res.status(Status.INTERNAL_ERROR).json({
            success: false,
            message: "Server error"
        });
    }
}




const addBrandOffer = async(req,res)=>{
    try{
        const { brandId, percentage, startDate, endDate, description } = req.body;

        // 1️⃣ Check if brand exists
        const brand = await Brand.findById(brandId);
        if (!brand) {
        return res.status(404).json({ status: false, message: "Brand not found" });
        }

        // 2️⃣ Find products in this brand
        const products = await Product.find({ brand: brand._id });

        // 3️⃣ Update each product's brandOffer & salePrice if needed
        if (products.length > 0) {
            const bulkOps = products.map((product) => {
                const update = { brandOffer: percentage };
                if (percentage > product.productOffer && percentage > product.categoryOffer) {
                update.salePrice = product.regularPrice * (1 - percentage / 100);
                }
                return {
                    updateOne: {
                        filter: { _id: product._id },
                        update: { $set: update },
                    },
                };
            });

            if (bulkOps.length > 0) {
                await Product.bulkWrite(bulkOps);
            }
        }

        // 4️⃣ Update category with offer info
        await Brand.updateOne(
            { _id: brandId },
            {
                $set: {
                offer: percentage,
                offerStartDate: startDate || null,
                offerEndDate: endDate || null,
                offerDescription: description || "",
                },
            }
        );

        // 5️⃣ Sync to Offer collection (centralized)
        await Offer.findOneAndUpdate(
            { refId: brand._id, type: "brand" },
            {
                name: brand.brandName,
                type: "brand",
                refId: brand._id,
                percentage,
                startDate: startDate || null,
                endDate: endDate || null,
                description: description || "",
                active: true,
            },
            { upsert: true } // create if not exists
        );

        // 6️⃣ Send response
        res.json({ status: true, message: "Brand offer added successfully" });
  } catch (error) {
        console.error("Error adding brand offer:", error);
        res.status(Status.INTERNAL_ERROR).json({ status: false, message: "Internal Server Error" });
  }
}



const removeBrandOffer=async(req,res)=>{
     try {
    const brandId = req.body.brandId;

    // Step 1: Find the category
    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res
        .status(404)
        .json({ status: false, message: "Brand not found" });
    }

    // Step 2: Reset category offer
    brand.offer = 0;
    await brand.save();

    // Step 3: Find all products in this category
    const products = await Product.find({ brand: brand._id });

    if (products.length > 0) {
      for (const product of products) {
        // Reset category offer
        product.brandOffer = 0;

        // Recalculate salePrice based on other active offers
        const maxOffer = Math.max(product.productOffer || 0, product.categoryOffer || 0);

        if (maxOffer > 0) {
          product.salePrice = product.regularPrice * (1 - maxOffer / 100);
        } else {
          product.salePrice = product.regularPrice;
        }

        await product.save();
      }
    }

    // Step 4: Deactivate the Offer document (if any)
    await Offer.deleteMany(
      { type: "brand", refId: brand._id, isActive: true },
      { $set: { isActive: false } }
    );

    // Step 5: Respond to client
    res.json({ status: true, message: "Brand offer removed successfully" });
  } catch (error) {
    console.error(error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, message: "Internal Server Error" });
  }
}


const loadEditBrand=async (req,res)=>{
    try {
        const id=req.params.id;
        const brand=await Brand.findOne({_id:id});

        if(!brand) return res.redirect('/admin/page-error');

        res.render('./admin/brand/3edit-brand',{
            layout:"adminLayout",
            title:"Edit Brand",
            brand:brand
        })
    } catch (error) {
        console.log("loadEditBrand error:",error);
        res.redirect('/admin/page-error')
    }
}



const editBrand=async (req,res)=>{
    try {
        const brandId = req.params.id;
        const { brandName } = req.body;
    
        const brand = await Brand.findById(brandId);
        if (!brand) {
          return res.status(404).json({ success: false, message: "Brand not found" });
        }
    
        if (brandName?.trim()) {
          brand.brandName = brandName.trim();
        }
    
        // ✅ New logo uploaded?
        if (req.file) {
            // 1️⃣ PROCESS IMAGE WITH SHARP
            let processedBuffer;
            try {
                processedBuffer = await sharp(req.file.buffer)
                .resize(500, 500, { fit: "cover" })
                .toFormat("webp")
                .webp({ quality: 85 })
                .toBuffer();
            } catch (err) {
                return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Failed to process image",
                error: err.message
                });
            }
        
            // 2️⃣ UPLOAD NEW IMAGE TO CLOUDINARY FIRST
            const uploadNewLogo = () => {
                return new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    { folder: "brand_logos", format: "webp" },
                    (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                    }
                ).end(processedBuffer);
                });
            };
        
            let newImg;
            try {
                newImg = await uploadNewLogo();
            } catch (error) {
                console.log(error)

                return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Failed to upload new logo to Cloudinary",
                error: error.message
                });
            }
        
            // 3️⃣ DELETE OLD IMAGE FROM CLOUDINARY (AFTER SUCCESS)
            try {
                await cloudinary.uploader.destroy(brand.cloudinaryId);
            } catch (err) {
                console.error("Old image delete failed:", err);
                // Not a critical failure, don't return error
            }
        
            // 4️⃣ UPDATE DATABASE
            brand.brandImage = newImg.secure_url;
            brand.cloudinaryId = newImg.public_id;
        }
    
        await brand.save();
    
        return res.json({
          success: true,
          message: "Brand updated successfully",
          brand
        });
    
      } catch (err) {
        console.error(err);
        return res.status(Status.INTERNAL_ERROR).json({
          success: false,
          message: "Server error"
        });
      }
}

const blockBrand=async (req,res)=>{
    try {
        const {brandId}=req.body;
        await Brand.updateOne({_id:brandId},{$set:{isBlocked:true}});
        res.json({success:true,message:"Brand blocked successfully"});
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error blocking the brand"})
        console.log("blockBrand error:",error);
    }
}

const unblockBrand=async (req,res)=>{
    try {
        const {brandId}=req.body;
        await Brand.updateOne({_id:brandId},{$set:{isBlocked:false}});
        res.json({success:true,message:"Brand unblocked successfully"});
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error unblocking the brand"})
        console.log("unblockBrand error:",error);
    }
}

const deleteBrand=async (req,res)=>{
    try {
        const {id}=req.query;
        if(!id){
            return res.status(Status.BAD_REQUEST).redirect('/admin/page-error')
        }
        await Brand.deleteOne({_id:id});
        res.redirect('/admin/brands')
    } catch (error) {
        console.error("Error deleting brand:",error)
        res.status(Status.INTERNAL_ERROR).redirect("/admin/page-error")
    }
}
module.exports={
    loadAllBrands,
    loadAddBrandPage,
    addBrand,
    addBrandOffer,
    removeBrandOffer,
    loadEditBrand,
    editBrand,
    blockBrand,
    unblockBrand,
    deleteBrand,
}