export interface AttachmentResponse {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

// What multer hands over with memory storage. Typed here rather than pulling in
// @types/multer for four fields.
export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}
