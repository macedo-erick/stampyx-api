import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { CONFIG, type Config } from '../config';
import { AttachmentController } from './attachment.controller';
import { AttachmentRepository } from './attachment.repository';
import { AttachmentService } from './attachment.service';

@Module({
  imports: [
    // Memory storage, then written to MAIL_ATTACHMENTS_DIR under the attachment id.
    MulterModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        limits: { fileSize: config.MAIL_MAX_ATTACHMENT_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [AttachmentController],
  providers: [AttachmentRepository, AttachmentService],
  exports: [AttachmentService, AttachmentRepository],
})
export class AttachmentsModule {}
