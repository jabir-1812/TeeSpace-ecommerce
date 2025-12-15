import Brand from '../../models/brandSchema.js'
import Product from '../../models/productSchema.js';




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







export default {
    loadAllBrands,
}