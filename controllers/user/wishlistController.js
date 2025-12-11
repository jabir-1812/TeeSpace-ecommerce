import Status from '../../constants/statusCodes.js';
import User from '../../models/userSchema.js';
import Wishlist from '../../models/wishlistSchema.js';
import Cart from '../../models/cartSchema.js';
import mongoose from 'mongoose';


const showWishlist = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const user = await User.findById(userId);

    // Get pagination params (default: page=1, limit=6)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const skip = (page - 1) * limit;

    // Find wishlist
    const wishlist = await Wishlist.findOne({ userId })
      .populate({
        path: "items.productId",
        select: "productName productImage regularPrice salePrice brand",
        populate: {
          path: "brand",
          select: "brandName",
        },
      })
      .lean();

    if (!wishlist || !wishlist.items || wishlist.items.length === 0) {
      return res.render("user/wishlist/2wishlist", {
        title: "Wishlist",
        wishlist: [],
        user,
        cartLength: "",
        currentPage: page,
        totalPages: 0,
      });
    }

    // Apply pagination manually on the populated items
    const totalItems = wishlist.items.length;
    const paginatedItems = wishlist.items.slice(skip, skip + limit);
    const totalPages = Math.ceil(totalItems / limit);

    res.render("user/wishlist/2wishlist", {
      title: "Wishlist",
      wishlist: paginatedItems,
      user,
      cartLength: "",
      currentPage: page,
      totalPages,
    });
  } catch (error) {
    console.log("showWishlist() error:", error);
    res.redirect("/page-not-found");
  }
};




const addToWishlist = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const productId = new mongoose.Types.ObjectId(req.body.productId);

    // Find the user's wishlist
    let wishlist = await Wishlist.findOne({ userId });

    // Create wishlist if it doesn't exist
    if (!wishlist) {
      wishlist = new Wishlist({ userId, items: [] });
    }

    // Check if product already exists
    const alreadyExists = wishlist.items.some(
      (item) => item.productId.toString() === productId.toString()
    );

    if (alreadyExists) {
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Already in wishlist" });
    }

    // Add new product
    wishlist.items.push({ productId });
    await wishlist.save();

    res.status(Status.OK).json({ success: true, message: "Added to Wishlist" });
  } catch (err) {
    console.error(err);
    res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Error adding to wishlist" });
  }
};




const removeFromWishlist=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const productId=req.params.id;

         const updatedWishlist = await Wishlist.findOneAndUpdate(
            { userId },
            { $pull: { items: { productId } } },
            { new: true }
        );
        return res.json({ success: true, message: "Removed from wishlist" });
    } catch (error) {
        console.log("removeFromWishlist() error:",error);
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Internal Server error"})
    }
}

export default {
    showWishlist,
    addToWishlist,
    removeFromWishlist
}