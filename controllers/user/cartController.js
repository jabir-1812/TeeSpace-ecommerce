import Status from '../../constants/statusCodes.js';
import User from '../../models/userSchema.js';
import Product from '../../models/productSchema.js';
import Cart from '../../models/cartSchema.js';
import Wishlist from '../../models/wishlistSchema.js';
import mongoose from 'mongoose';


const loadCart = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const user = await User.findById(userId);

    let userCart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        populate: [
          { path: "brand", select: "brandName" },
          { path: "category", select: "name" }
        ]
      });

    if (!userCart) {
      return res.render("user/2cart", { title: "Cart", user, userCart: null, totalAmount: 0, cartLength: 0 ,totalPrice:0});
    }

    let totalPrice=0;
    let totalAmount = 0;
    let cartUpdated = false;

    // Check each item quantity vs stock
    for (let i = 0; i < userCart.items.length; i++) {
      let item = userCart.items[i];
      if (item.productId && item.quantity > item.productId.quantity) {
        item.quantity = item.productId.quantity; // reduce to available stock
        cartUpdated = true;
      }
      totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
      totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
    }

    // If any change happened, save updated cart
    if (cartUpdated) {
      await userCart.save();
    }

    // Convert to plain object for rendering
    userCart = userCart.toObject();

    res.render("user/2cart", {
      title: "Cart",
      user,
      userCart,
      totalPrice,
      totalAmount,
      cartLength: userCart.items.length
    });

  } catch (error) {
    console.log("loadCart() error:", error);
    res.redirect("/page-not-found");
  }
};



const addToCart = async (req, res) => {
  try {
    console.log('req.url:', req.url);
console.log('req.originalUrl:', req.originalUrl);
console.log('req.path:', req.path);

    const productId = req.body.productId;
    const userId = req.session.user || req.session.passport?.user;

    let userCart = await Cart.findOne({ userId: userId }); // safer than findById

    // If no cart exists, create a new one
    if (!userCart) {
      userCart = await Cart.create({
        userId: userId,
        items: []
      });
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      return res.json({ status: false, message: "Product not found" });
    }

    if (product.quantity <= 0) {
      return res.json({ status: false, message: "Out of stock" });
    }

    const cartItemIndex = userCart.items.findIndex(
      (item) => item.productId.toString() === productId
    );

    if (cartItemIndex === -1) {
      const quantity = 1;
      await Cart.updateOne(
        { userId: userId },
        {
          $push: {
            items: { productId: productId, quantity: quantity },
          },
        }
      );
      if(req.url==='/wishlist/add-to-cart'){
          console.log("delete")
          await Wishlist.findOneAndUpdate(
              { userId },
              { $pull: { items: { productId } } },
              { new: true }
          );
        }

      return res.json({ status: true, cartLength: userCart.items.length + 1 });
    } else {
      const productInCart = userCart.items[cartItemIndex];
      if (productInCart.quantity < product.quantity) {
        const newQuantity = productInCart.quantity + 1;
        if (newQuantity > 3) {
          return res.json({ status: false, message: "Cart limit exceeded" });
        }
        await Cart.updateOne(
          { userId: userId, "items.productId": productId },
          { $set: { "items.$.quantity": newQuantity } }
        );
        if(req.url==='/wishlist/add-to-cart'){
          console.log("delete")
          await Wishlist.findOneAndUpdate(
              { userId },
              { $pull: { items: { productId } } },
              { new: true }
          );
        }
        return res.json({ status: true, cartLength: userCart.items.length });
      } else {
        return res.json({ status: false, message: "Out of stock" });
      }
    }
  } catch (error) {
    console.error("addToCart() error:", error);
    return res.redirect("/page-not-found");
  }
};




const changeCartQuantity = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const { productId, count } = req.body;
    console.log('count======>',count)
    console.log('type of count======>',typeof count)

    // Find the product in the user's cart
    const cartProduct = await Cart.findOne(
      {
        userId: new mongoose.Types.ObjectId(String(userId)),
        "items.productId": new mongoose.Types.ObjectId(String(productId))
      },
      { "items.$": 1 }
    );

    if (!cartProduct || !cartProduct.items.length) {
      return res.status(404).json({ status: false, message: "Product not in cart" });
    }

    let cartProductQty = cartProduct.items[0].quantity;
    let updatedCartProductQty=cartProductQty;// final quantity to send to Front-end

    // Check product stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    let status = true;

    if (product.quantity >= cartProductQty + count && product.quantity > 0) {
      updatedCartProductQty = cartProductQty + count;
      await Cart.updateOne(
        {
          userId: new mongoose.Types.ObjectId(String(userId)),
          "items.productId": new mongoose.Types.ObjectId(String(productId))
        },
        { $inc: { "items.$.quantity": count } }
      );
    } else {
      updatedCartProductQty = product.quantity;
      status = false; // adjustment happened
      await Cart.updateOne(
        {
          userId: new mongoose.Types.ObjectId(String(userId)),
          "items.productId": new mongoose.Types.ObjectId(String(productId))
        },
        { $set: { "items.$.quantity": updatedCartProductQty } }
      );
    }

    const updatedCart = await Cart.findOne({ userId }).populate("items.productId");
    const totalAmount = updatedCart.items.reduce((sum, item) => {
      return sum + (item.productId ? item.productId.salePrice * item.quantity : 0);
    }, 0);
    const totalPrice=totalAmount;

    res.status(Status.OK).json({
      status,
      message: status ? "Quantity updated" : "Adjusted to available stock",
      updatedCartProductQty, // send final quantity
      totalPrice,
      totalAmount
    });

  } catch (error) {
    console.log("changeCartQuantity() error:", error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, error: "Server error" });
  }
};


const deleteCartItem =async (req,res)=>{
 try {
    const userId = req.session.user || req.session.passport?.user;
    const productId = req.params.id;

    await Cart.updateOne(
      { userId: new mongoose.Types.ObjectId(String(userId)) },
      { $pull: { items: { productId: new mongoose.Types.ObjectId(String(productId)) } } }
    );

    res.status(Status.OK).json({ status: true, message: "Item removed" });
  } catch (error) {
    console.log('deleteCartItem() error:', error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, error: "Server error" });
  }
}










const checkCartBeforeCheckout=async(req,res)=>{
  try {
    const userId = req.session.user || req.session.passport?.user;
    const userCart=await Cart.findOne({userId})
      .populate({
        path:"items.productId",
        select:"productName productImage quantity isBlocked",
      })

      if(!userCart){
        return res.status(Status.NOT_FOUND).json({message:"Cart not found"})
      }

      if(userCart.items.length===0){
        return res.status(Status.BAD_REQUEST).json({isCartEmpty:true,message:"Add product in the cart"})
      }

      const outOfStockProducts=[]

      for(let i=0;i<userCart.items.length;i++){
        let item=userCart.items[i];
        if(item.productId.quantity===0){
          outOfStockProducts.push(item)
        }
      }

      const zeroQtyCartItems=[]

      for(let i=0;i<userCart.items.length;i++){
        let item=userCart.items[i];
        if(item.quantity===0){
          zeroQtyCartItems.push(item)
        }
      }

      const blockedProductsData=[]

      for(let i=0;i<userCart.items.length;i++){
        let item=userCart.items[i];
        if(item.productId.isBlocked){
          blockedProductsData.push(item)
        }
      }

      const qtyMismatchItems=[]
      //check each cart item quantity vs product qty
      for(let i=0;i<userCart.items.length;i++){
        let item=userCart.items[i];
        if(item.productId && item.quantity > item.productId.quantity){
          qtyMismatchItems.push(item)
        }
      }


      if(blockedProductsData.length > 0||qtyMismatchItems.length > 0  || outOfStockProducts.length > 0 || zeroQtyCartItems.length > 0){
        return res.json({success:false,blockedProductsData,qtyMismatchItems,outOfStockProducts,zeroQtyCartItems})
      }
      return res.json({success:true})

  } catch (error) {
    console.log("checkCartBeforeCheckout() error:======",error)
    res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}





export default {
  loadCart,
  addToCart,
  changeCartQuantity,
  deleteCartItem,
  checkCartBeforeCheckout
};

