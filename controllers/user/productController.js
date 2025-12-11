import Status from '../../constants/statusCodes.js';
import Product from '../../models/productSchema.js';
import Category from '../../models/categorySchema.js';
import User from '../../models/userSchema.js';



// const productDetails=async(req,res)=>{
//     console.log("product details has started")
//     try {
//         const userId=req.session.user;
//         const userData=await User.findById(userId);
//         const productId=req.query.id;
//         const product=await Product.findById(productId).populate('category').populate('brand');



//         const findCategory=product.category;
//         const categoryOffer=findCategory ?.categoryOffer || 0;
//         const productOffer=product.productOffer || 0;
//         const totalOffer=categoryOffer+productOffer;
//         res.render('./user/product-details',{
//             title:"product details",
//             user:userData,
//             product:product,
//             quantity:product.quantity,
//             totalOffer:totalOffer,
//             category:findCategory
//         })
//     } catch (error) {
//         console.error("Error for fetching product details:",error);
//         res.redirect("/page-not-found");
//     }
// }

const productDetails = async (req,res)=>{
    try {
        const user=req.session.user || req.session.passport?.user;
        const userData=await User.findById(user);
        const productId=req.query.id;
        const product=await Product.findById(productId).populate('brand').populate('category');
        

        res.render('./user/3product-details',{
            title:"Product details",
            user:userData,
            product,
            url:req.url,
            cartLength: userData.cart.length
        })
    } catch (error) {
        console.log("productDetails error:",error);
        res.redirect('/page-not-found')
    }
}

export default {
    productDetails
}