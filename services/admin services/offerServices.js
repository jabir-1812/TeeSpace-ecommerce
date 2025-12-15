import Offer from "../../models/offerSchema.js";





async function updateBrandOffer(brand, percentage, startDate=null, endDate=null, description="") {
    return Offer.findOneAndUpdate(
        { refId: brand._id, type: "brand" },
        {
            name: brand.brandName,
            type: "brand",
            refId: brand._id,
            percentage,
            startDate: startDate,
            endDate: endDate,
            description: description,
            active: true,
        },
        { upsert: true } // create if not exists
    );

}










export default {
    updateBrandOffer
}