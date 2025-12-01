const STATUS_CODES=require('../constants/statusCodes')




const errorHandler = async (err, req, res, next)=>{
    try {
            console.error(err.stack);
            res.status(STATUS_CODES.INTERNAL_ERROR).render('error-page', { title: "Server Error" });
    } catch (error) {
        console.error("errorHandler() middleware error===",error)
    }
}



module.exports = {
    errorHandler
}
