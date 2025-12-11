import STATUS_CODE from '../constants/statusCodes.js';




const errorHandler = async (err, req, res, next)=>{
    try {
            console.error(err.stack);
            res.status(STATUS_CODE.INTERNAL_ERROR).render('error-page', { title: "Server Error" });
    } catch (error) {
        console.error("errorHandler() middleware error===",error)
    }
}



export default errorHandler
