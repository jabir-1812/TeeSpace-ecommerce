import Coupon from '../models/couponSchema.js';

async function giveReferralCoupon(userId) {
  // // Check if already rewarded
  //   const exists = await Coupon.findOne({ referrer: referrerId });

  //   if (exists) {
  //       console.log("Referral reward already given. Skipping.");
  //       return;
  //   }
  const couponCode = 'REF' + Math.floor(100000 + Math.random() * 900000);

  const now=new Date();
  const oneYearFromNow=new Date(now);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear()+1);
  oneYearFromNow.setHours(0,0,0,0)


  await Coupon.create({
    userId,
    couponCode,
    discountType:"percentage",
    discountValue: 10,
    startDate:now,
    expiryDate:oneYearFromNow,
    maxUses:1,
    maxDiscountAmount:1000,
    type: 'referral',
    description:"10% OFF on all oders"
  });
}

export default giveReferralCoupon;

