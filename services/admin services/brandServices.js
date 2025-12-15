import Brand from '../../models/brandSchema.js'
import Product from '../../models/productSchema.js';
import sharp from 'sharp';
import cloudinary from '../../config/cloudinary.js';
import Offer from '../../models/offerSchema.js';


async function loadAllBrands(search, page) {
    const ITEMS_PER_PAGE=5;
    const totalBrands=await Brand.countDocuments({brandName:{$regex:".*"+search+".*",$options:"i"}})
    const totalPages=Math.ceil(totalBrands/ITEMS_PER_PAGE);
    const brands=await Brand.find({brandName:{$regex:".*"+search+".*",$options:"i"}})
        .sort({createdAt:-1})
        .skip((page-1)*ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE)

    const products=await Product.aggregate([{$group:{_id:"$brand",productsCount:{$sum:1}}}])

    //to show how much product each brand has.
    for(const brand of brands){
        for(const p of products){
            if(brand._id.toString()===p._id.toString()){
                brand.productsCount=p.productsCount;
            }
        }
    }

    return {brands, products, totalBrands, totalPages}
}





async function findBrandByBrandName(brandName) {
    return Brand.findOne({brandName:{$regex:`^${brandName}$`,$options:"i"}})
}



async function findBrandbyBrandId(brandId) {
    return Brand.findById(brandId)
}






async function resizeBrandImage(buffer){
    return sharp(buffer) // from multer memory storage
        .resize(500, 500, { fit: "cover" })  // ✅ crop center
        .toFormat("webp")                    // ✅ convert to webp
        .webp({ quality: 85 })               // ✅ compression
        .toBuffer();
}





async function uploadBrandImageToCloudinary(processedBuffer) {
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
}




async function createBrand(brandName, uploadResult) {
    return Brand.create({
        brandName,
        brandImage: uploadResult.secure_url,
        cloudinaryId: uploadResult.public_id
    });
}





async function findAllProductsOfThisBrand(brandId) {
    return Product.find({brand:brandId})
}



async function updateProductSalePrices(products,percentage) {
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


async function updateOfferDetailsInBrand(brandId, percentage, startDate=null, endDate=null, description="") {
    await Brand.updateOne(
        { _id: brandId },
        {
            $set: {
            offer: percentage,
            offerStartDate: startDate,
            offerEndDate: endDate,
            offerDescription: description,
            },
        }
    );
}








export default {
    loadAllBrands,
    findBrandByBrandName,
    findBrandbyBrandId,
    createBrand,
    resizeBrandImage,
    uploadBrandImageToCloudinary,
    findAllProductsOfThisBrand,
    updateProductSalePrices,
    updateOfferDetailsInBrand
}