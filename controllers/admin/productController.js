import Status from '../../constants/statusCodes.js';
import path from 'path';
import fs from 'fs';
import Brand from '../../models/brandSchema.js';
import Category from '../../models/categorySchema.js';
import Product from '../../models/productSchema.js';
import cloudinary from '../../config/cloudinary.js';
import sharp from 'sharp';




const loadAddProductPage = async (req,res)=>{
    try {
        const category=await Category.find({isDeleted:false});
        const brand=await Brand.find({isBlocked:false})

        res.render('./admin/products/2add-product',{
            layout:"adminLayout",
            title:"Add Product",
            brand:brand,
            category:category
        })
    } catch (error) {
        console.log('error loading the add-product page:',error);
        res.redirect('/admin/page-error');
    }
}




async function uploadImages(buffer, folder){
  return new Promise(async (resolve, reject) => {
    let processed;

    try {
      processed = await sharp(buffer)
        .resize(800, 800, { fit: "cover" })
        .toFormat("webp")
        .webp({ quality: 85 })
        .toBuffer();
    } catch (err) {
      return reject({ step: "sharp", error: err });
    }

    const stream = cloudinary.uploader.upload_stream(
      { folder, format: "webp" },
      (error, result) => {
        if (error) return reject({ step: "cloudinary", error });
        resolve(result);
      }
    );

    stream.end(processed);
  });
};

const addProduct=async (req,res)=>{
    try {
        const product=req.body;
        const {productName}=req.body;
        const isProductExists=await Product.findOne({
            productName:productName
        })

        if(isProductExists){
            return  res.status(Status.BAD_REQUEST).json({message:"Product name already exists"});
        }

        const images=[];
        if(!req.files || req.files.length<3){
            console.log("uploaded images are less than 3.required atleast 3")
            throw new Error("required atleast 3 images to add a product")
        }


        let uploadedImages;
        try {
            uploadedImages=await Promise.all(
                req.files.map((file)=>uploadImages(file.buffer,"product_images"))
            );
        } catch (error) {
            console.error("Upload failed:", err);

            return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Failed to upload one or more images",
                error: err.error?.message || err.message
            });
        }
        const productImages=uploadedImages.map((img)=>{
            return {
                url:img.secure_url,
                id:img.public_id
            }
        })


        const category=await Category.findOne({name:product.category});

        if(!category){
            console.log("error adding product:invalid category name")
            return res.status(Status.BAD_REQUEST).json({message:'Invalid category name'})
        }

        const brand=await Brand.findOne({brandName:product.brand})
        if(!brand){
            console.log("Error adding product:invalid brand name")
            return res.status(Status.BAD_REQUEST).json({message:"Invalid brand name"});
        }

        const newProduct=new Product({
            productName:product.productName,
            description:product.productDescription,
            brand:brand._id,
            category:category._id,
            regularPrice:product.regularPrice,
            salePrice:product.salePrice,
            createdOn:new Date(),
            quantity:product.quantity,
            size:product.size,
            color:product.color,
            productImage:productImages,
            status:"Available",
        })
        await newProduct.save();
        return res.json({success:true, message:"New product added successfully"})

    } catch (error) {
        console.log("error adding/saving product:",error)
        res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
    }
}










const loadAllProductsPage = async (req, res) => {
    try {
        // Get all products with pagination and search
        const ITEMS_PER_PAGE = 5;
        const page = parseInt(req.query.page) || 1;
        const search = req.query.search || "";

        const categoryObj = await Category.findOne({
        name: { $regex: ".*" + search + ".*", $options: "i" },
        });

        const brandObj=await Brand.findOne({
            brandName:{$regex:".*"+search+".*",$options:"i"}
        });

        const orConditions = [
        { productName: { $regex: ".*" + search + ".*", $options: "i" } }
        ];

        if (categoryObj) {
        orConditions.push({ category: categoryObj._id });
        }
        if(brandObj){
            orConditions.push({brand:brandObj._id});
        }

        const totalProducts = await Product.countDocuments({ $or: orConditions });

        const product = await Product.find({ $or: orConditions })
        .sort({ createdAt: -1 })
        .skip((page - 1) * ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE)
        .populate("category")
        .populate("brand")
        .exec();


        res.render("./admin/products/product", {
        layout:"adminLayout",
        title: "Products",
        product,
        search,
        totalProducts,
        totalPages: Math.ceil(totalProducts / ITEMS_PER_PAGE),
        currentPage: page,
        });
    } catch (error) {
        console.log("error loading the product management page:", error);
        res.redirect("/admin/page-error");
    }
};




const addProductOffer=async (req,res)=>{
    try {
        const percentage=parseInt(req.body.percentage);
        const productId=req.body.productId;
        const product=await Product.findById(productId);

        if(!product){
            return res.status(404).json({status:false,message:"Product not found"});
        }

        if(product){
            product.productOffer=percentage;
            if(percentage < product.categoryOffer || percentage < product.brandOffer){
                const higherOffer=product.brandOffer > product.categoryOffer ? `Brand Offer:${product.brandOffer}%` : `Product Offer${product.categoryOffer}%`;
                await product.save();
                return res.json({
                    status:true,
                    message:`Note:Product has an higer offer already.<br>
                            The product has ${higherOffer}<br>
                            so the higher offer will be applied`,
                    categoryOffer:product.categoryOffer,
                    brandOffer:product.brandOffer,
                    salePrice:product.salePrice
                })
            }
            product.salePrice=product.regularPrice*(1-percentage/100);
            await product.save();
            res.json({status:true,message:"",categoryOffer:product.categoryOffer,brandOffer:product.brandOffer,salePrice:product.salePrice})
        }
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({status:false,message:"Internal Server Error"})
    }
}


const removeProductOffer = async (req, res) => {
  try {
    const { productId } = req.body;
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    // Remove the product offer
    product.productOffer = 0;

    // Find which offer (brand/category) is higher
    const highestOffer = Math.max(product.brandOffer, product.categoryOffer);

    if (highestOffer > 0) {
      product.salePrice = product.regularPrice * (1 - highestOffer / 100);
    } else {
      product.salePrice = product.regularPrice;
    }

    await product.save();

    res.json({ status: true, salePrice: product.salePrice });
  } catch (error) {
    res.status(Status.INTERNAL_ERROR).json({ status: false, message: "Internal Server Error" });
  }
};


const blockUnblockProduct= async (req,res)=>{
    try {
        const product = await Product.findOne({_id:req.params.id});
        console.log("product:",product);
        console.log("product isBlocked:",product.isBlocked);

        if(product.isBlocked===false){
            await Product.findByIdAndUpdate(req.params.id,{isBlocked:true});
            return res.redirect('/admin/products');
        }
        if(product.isBlocked===true){
            await Product.findByIdAndUpdate(req.params.id,{isBlocked:false});
            return res.redirect('/admin/products');
        }
    } catch (error) {
        console.log("error blocking the product",error);
        res.redirect('/admin/page-error')
    }
}

const unblockProduct = async (req,res)=>{
    try {
        const {productId}=req.body;
        await Product.updateOne({_id:productId},{$set:{isBlocked:false,status:"Available"}});
        res.json({success:true,message:"Product unblocked successfully"});
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Error unblocking the product"})
        console.log("unblockBrand error:",error)
    }
}


const blockProduct = async (req,res)=>{
    try {
        const {productId}=req.body;
        await Product.updateOne({_id:productId},{$set:{isBlocked:true,status:"Unavailable"}});
        res.json({success:true,message:"Product blocked successfully"});
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Error blocking the product"})
        console.log("blockBrand error:",error)
    }
}







const loadEditProductPage = async (req,res)=>{
    try {
        const id=req.params.id;
        const product = await Product.findOne({_id:id});
        const category = await Category.find({})
        const brand = await Brand.find({})

        res.render('./admin/products/3edit-product',{
            layout:"adminLayout",
            title:"Edit Product",
            product:product,
            category:category,
            brand:brand
        })
        
    } catch (error) {
        console.log("error rendering the edit-product page:",error)
        res.redirect('/admin/page-error')
    }
}






const editProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        const brand=await Brand.findOne({brandName:req.body.brand})
        if(!brand){
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        const category=await Category.findOne({name:req.body.category})
        if(!category){
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        /** ✅ STEP 1: Parse removedImages from frontend */
        const removedImages = JSON.parse(req.body.removedImages || "[]"); 
        // Example: ["https://..../img1.webp", "https://..../img3.webp"]

        /** ✅ STEP 2: Determine which old images should be deleted */
        const imagesToDelete = product.productImage.filter(img =>
            removedImages.includes(img.url)
        );

        /** ✅ STEP 3: Keep old images that were NOT removed */
        let updatedImages = product.productImage.filter(
            img => !removedImages.includes(img.url)
        );

        /** ✅ STEP 4: Upload NEW images first (safe!) */
        let newUploads = [];

        if (req.files && req.files.length > 0) {
            try {
                newUploads = await Promise.all(
                    req.files.map(async (file) => {

                        // ✅ SHARP processing
                        let processedBuffer;
                        try {
                            processedBuffer = await sharp(file.buffer)
                                .resize(800, 800, { fit: "cover" })
                                .webp({ quality: 85 })
                                .toBuffer();
                        } catch (sharpErr) {
                            return Promise.reject({
                                type: "sharp",
                                message: sharpErr.message
                            });
                        }

                        // ✅ CLOUDINARY upload
                        return new Promise((resolve, reject) => {
                            cloudinary.uploader.upload_stream(
                                { folder: "product_images", format: "webp" },
                                (error, result) => {
                                    if (error) {
                                        return reject({
                                            type: "cloudinary",
                                            message: error.message
                                        });
                                    }

                                    resolve({
                                        url: result.secure_url,
                                        id: result.public_id
                                    });
                                }
                            ).end(processedBuffer);
                        });
                    })
                );
            } catch (err) {
                console.error("Upload error:", err);

                if (err.type === "sharp") {
                    return res.status(Status.BAD_REQUEST).json({
                        success: false,
                        message: "Image processing failed",
                        error: err.message
                    });
                }

                if (err.type === "cloudinary") {
                    return res.status(Status.INTERNAL_ERROR).json({
                        success: false,
                        message: "Failed to upload image to Cloudinary",
                        error: err.message
                    });
                }

                return res.status(Status.INTERNAL_ERROR).json({
                    success: false,
                    message: "Unexpected image upload error",
                });
            }
        }

        /** ✅ STEP 5: AFTER upload succeeded → delete removed Cloudinary images */
        try {
            await Promise.all(
                imagesToDelete.map(img =>
                    cloudinary.uploader.destroy(img.id)
                )
            );
        } catch (deleteErr) {
            console.error("Cloudinary deletion error:", deleteErr.message);
            // ✅ Do not break update – only log error
        }

        /** ✅ STEP 6: Build final image list */
        updatedImages = [...updatedImages, ...newUploads];

        /** ✅ STEP 7: Update product fields */
        product.productName = req.body.productName || product.productName;
        product.description = req.body.productDescription || product.description;
        product.regularPrice = req.body.regularPrice || product.regularPrice;
        product.salePrice = req.body.salePrice || product.salePrice;
        product.quantity = req.body.quantity || product.quantity
        product.color = req.body.color || product.color
        product.productImage = updatedImages;
        product.category = category._id || product.category;
        product.brand = brand._id || product.brand;

        await product.save();

        return res.json({
            success: true,
            message: "Product updated successfully",
            product
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Server error" });
    }
};







export default {
    loadAddProductPage,
    addProduct,
    loadAllProductsPage,
    addProductOffer,
    removeProductOffer,
    blockUnblockProduct,
    loadEditProductPage,
    editProduct,
    blockProduct,
    unblockProduct
}
