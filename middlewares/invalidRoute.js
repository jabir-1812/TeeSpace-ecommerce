const invalidRoute=async (req, res) => {
    try {
        res.render('invalid-route',{
            title:"Invalid Route"
        })
    } catch (error) {
        console.error("invalidRoute() middleware error==",error)
    }
}

module.exports={
    invalidRoute
}