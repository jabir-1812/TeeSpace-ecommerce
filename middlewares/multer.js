import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(), // no file saved locally // store in RAM for cloud upload
});

export default upload;
