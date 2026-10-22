import type {
  FileActor,
  FileDto,
  FilesApi,
  RegisterInput,
  StoreGeneratedInput,
  UploadTicket,
} from '../../contracts'
import type { AttachFile } from '../use-cases/attach-file'
import type { GetStorageUsage } from '../use-cases/get-storage-usage'
import type { RegisterFile } from '../use-cases/register-file'
import type { RemoveFile } from '../use-cases/remove-file'
import type { SignFileUrl } from '../use-cases/sign-file-url'
import type { StoreGeneratedFile } from '../use-cases/store-generated-file'
import type { VerifyFile } from '../use-cases/verify-file'

export interface FilesApiUseCases {
  registerFile: RegisterFile
  verifyFile: VerifyFile
  attachFile: AttachFile
  removeFile: RemoveFile
  getStorageUsage: GetStorageUsage
  signFileUrl: SignFileUrl
  storeGeneratedFile: StoreGeneratedFile
}

/** `FilesApi` (DOC-37 §3): the one door to `building.file_object` and to the bucket for every module. */
export class FilesApiImpl implements FilesApi {
  constructor(private readonly uc: FilesApiUseCases) {}

  register(actor: FileActor, input: RegisterInput): Promise<UploadTicket> {
    return this.uc.registerFile.execute(actor, input)
  }

  verify(actor: FileActor, fileId: string): Promise<FileDto> {
    return this.uc.verifyFile.execute(actor, fileId)
  }

  attach(actor: FileActor, fileId: string, ownerRef: string): Promise<void> {
    return this.uc.attachFile.execute(actor, fileId, ownerRef)
  }

  remove(actor: FileActor, fileId: string): Promise<void> {
    return this.uc.removeFile.execute(actor, fileId)
  }

  usage(buildingId: string) {
    return this.uc.getStorageUsage.execute(buildingId)
  }

  signedUrl(
    fileId: string,
    opts?: { variant?: 'original' | 'thumb'; downloadName?: string },
  ): Promise<string | null> {
    return this.uc.signFileUrl.execute(fileId, opts)
  }

  storeGenerated(input: StoreGeneratedInput): Promise<FileDto> {
    return this.uc.storeGeneratedFile.execute(input)
  }
}
