import { type Clock, NotFoundError, ValidationError } from '@core/kernel'
import type { ResidentSession } from '@rms/shared-types'
import type { Language } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'
import { ResidentAccount } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import { type ResidentProfile, toResidentProfile } from './verify-otp'

export interface UpdateResidentMeInput {
  language?: Language
  pushEnabled?: boolean
}

/**
 * `PATCH /me` (E-14, DOC-51 §5): the resident sets their language and the push toggle. The name and the phone are the Manager's
 * record and are not here; the avatar waits for the file attach of the resident app (DOC-37 §6.4). A person edits their own
 * preferences, so there is no `If-Match`: the last write wins (DR-146). Resident actions are not audited (DOC-35 §4.3).
 */
export class UpdateResidentMe {
  constructor(
    private readonly residents: ResidentAccountRepository,
    private readonly clock: Clock,
  ) {}

  async execute(resident: ResidentSession, input: UpdateResidentMeInput): Promise<ResidentProfile> {
    if (input.language === undefined && input.pushEnabled === undefined)
      throw new ValidationError([{ path: '', code: 'min_properties', message: 'min_properties' }])
    const [record] = await this.residents.findByIds([resident.accountId])
    if (!record) throw new NotFoundError()
    const account = new ResidentAccount(record)
    if (!account.canSignIn) throw new UnauthenticatedError()
    const transition = account.editPreferences(input)
    if (!transition) return toResidentProfile(record)
    if (!(await this.residents.apply(transition, this.clock.now()))) throw new NotFoundError()
    return toResidentProfile({ ...record, ...transition.set })
  }
}
