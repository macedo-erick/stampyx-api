import { Module } from '@nestjs/common';

import { MessagesModule } from '../messages/messages.module';
import { FolderController } from './folder.controller';
import { FolderRepository } from './folder.repository';
import { FolderService } from './folder.service';

@Module({
  imports: [MessagesModule],
  controllers: [FolderController],
  providers: [FolderRepository, FolderService],
  exports: [FolderRepository],
})
export class FoldersModule {}
