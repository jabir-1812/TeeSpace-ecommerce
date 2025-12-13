import User from '../../models/userSchema.js';
import bcrypt from 'bcrypt'





async function findAdmin(email) {
    return User.findOne({email,isAdmin:true})
}





async function comparePassword(enteredPassword, originalPassword) {
    return await bcrypt.compare(enteredPassword, originalPassword)
}







export default {
    findAdmin,
    comparePassword
}