import type { IconName } from '@rms/design-tokens'
import {
  Bell,
  Broom,
  Buildings,
  CalendarBlank,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  Car,
  ChatCircleDots,
  Check,
  CheckCircle,
  Clock,
  DoorOpen,
  DotsThree,
  DownloadSimple,
  Drop,
  Elevator,
  FileText,
  FireExtinguisher,
  Gear,
  Headset,
  House,
  Image,
  Info,
  Key,
  Lightning,
  Lock,
  MagnifyingGlass,
  MapPin,
  Megaphone,
  Minus,
  Motorcycle,
  NotePencil,
  Package,
  PencilSimple,
  Phone,
  type Icon as PhosphorIcon,
  Plus,
  QrCode,
  Receipt,
  SignOut,
  SquaresFour,
  Star,
  Trash,
  UploadSimple,
  UserCircle,
  UsersThree,
  Wallet,
  Warning,
  Wrench,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { cn } from '../../lib/utils'

/**
 * The typed registry of DOC-54 §7.3: exactly the names of `ICON_NAMES`, so an unknown name does not compile and a name without a
 * component fails `Record<IconName, …>` (test DS-06).
 */
export const ICONS: Record<IconName, PhosphorIcon> = {
  house: House,
  receipt: Receipt,
  'squares-four': SquaresFour,
  bell: Bell,
  'user-circle': UserCircle,
  plus: Plus,
  minus: Minus,
  x: X,
  check: Check,
  'caret-left': CaretLeft,
  'caret-right': CaretRight,
  'caret-down': CaretDown,
  'magnifying-glass': MagnifyingGlass,
  'pencil-simple': PencilSimple,
  trash: Trash,
  camera: Camera,
  image: Image,
  'qr-code': QrCode,
  phone: Phone,
  'chat-circle-dots': ChatCircleDots,
  'sign-out': SignOut,
  gear: Gear,
  'dots-three': DotsThree,
  lock: Lock,
  'upload-simple': UploadSimple,
  'download-simple': DownloadSimple,
  'file-text': FileText,
  'calendar-blank': CalendarBlank,
  clock: Clock,
  'map-pin': MapPin,
  info: Info,
  warning: Warning,
  'check-circle': CheckCircle,
  'x-circle': XCircle,
  star: Star,
  buildings: Buildings,
  elevator: Elevator,
  key: Key,
  'door-open': DoorOpen,
  package: Package,
  'fire-extinguisher': FireExtinguisher,
  broom: Broom,
  wrench: Wrench,
  megaphone: Megaphone,
  headset: Headset,
  'note-pencil': NotePencil,
  'users-three': UsersThree,
  wallet: Wallet,
  drop: Drop,
  lightning: Lightning,
  car: Car,
  motorcycle: Motorcycle,
}

const SIZES = { sm: 'size-icon-sm', md: 'size-icon-md', lg: 'size-icon-lg' } as const

interface IconProps {
  name: IconName
  size?: keyof typeof SIZES
  weight?: 'regular' | 'fill' | 'bold'
  /** Present when the icon alone carries a meaning; a decorative icon is hidden from assistive technology (DOC-54 §7.3). */
  label?: string
  className?: string
}

export function Icon({ name, size = 'md', weight = 'regular', label, className }: IconProps) {
  const Component = ICONS[name]
  return (
    <Component
      weight={weight}
      className={cn('shrink-0', SIZES[size], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
