import type { IconName } from '@rms/design-tokens'
import { Bell } from 'phosphor-react-native/src/icons/Bell'
import { Broom } from 'phosphor-react-native/src/icons/Broom'
import { Buildings } from 'phosphor-react-native/src/icons/Buildings'
import { CalendarBlank } from 'phosphor-react-native/src/icons/CalendarBlank'
import { Camera } from 'phosphor-react-native/src/icons/Camera'
import { Car } from 'phosphor-react-native/src/icons/Car'
import { CaretDown } from 'phosphor-react-native/src/icons/CaretDown'
import { CaretLeft } from 'phosphor-react-native/src/icons/CaretLeft'
import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight'
import { ChatCircleDots } from 'phosphor-react-native/src/icons/ChatCircleDots'
import { Check } from 'phosphor-react-native/src/icons/Check'
import { CheckCircle } from 'phosphor-react-native/src/icons/CheckCircle'
import { Clock } from 'phosphor-react-native/src/icons/Clock'
import { Desktop } from 'phosphor-react-native/src/icons/Desktop'
import { DoorOpen } from 'phosphor-react-native/src/icons/DoorOpen'
import { DotsThree } from 'phosphor-react-native/src/icons/DotsThree'
import { DownloadSimple } from 'phosphor-react-native/src/icons/DownloadSimple'
import { Drop } from 'phosphor-react-native/src/icons/Drop'
import { Elevator } from 'phosphor-react-native/src/icons/Elevator'
import { FileText } from 'phosphor-react-native/src/icons/FileText'
import { FireExtinguisher } from 'phosphor-react-native/src/icons/FireExtinguisher'
import { Gear } from 'phosphor-react-native/src/icons/Gear'
import { Headset } from 'phosphor-react-native/src/icons/Headset'
import { House } from 'phosphor-react-native/src/icons/House'
import { Image } from 'phosphor-react-native/src/icons/Image'
import { Info } from 'phosphor-react-native/src/icons/Info'
import { Key } from 'phosphor-react-native/src/icons/Key'
import { Lightning } from 'phosphor-react-native/src/icons/Lightning'
import { Lock } from 'phosphor-react-native/src/icons/Lock'
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass'
import { MapPin } from 'phosphor-react-native/src/icons/MapPin'
import { Megaphone } from 'phosphor-react-native/src/icons/Megaphone'
import { Minus } from 'phosphor-react-native/src/icons/Minus'
import { Moon } from 'phosphor-react-native/src/icons/Moon'
import { Motorcycle } from 'phosphor-react-native/src/icons/Motorcycle'
import { NotePencil } from 'phosphor-react-native/src/icons/NotePencil'
import { Package } from 'phosphor-react-native/src/icons/Package'
import { PencilSimple } from 'phosphor-react-native/src/icons/PencilSimple'
import { Phone } from 'phosphor-react-native/src/icons/Phone'
import { Plus } from 'phosphor-react-native/src/icons/Plus'
import { QrCode } from 'phosphor-react-native/src/icons/QrCode'
import { Receipt } from 'phosphor-react-native/src/icons/Receipt'
import { SidebarSimple } from 'phosphor-react-native/src/icons/SidebarSimple'
import { SignOut } from 'phosphor-react-native/src/icons/SignOut'
import { SquaresFour } from 'phosphor-react-native/src/icons/SquaresFour'
import { Star } from 'phosphor-react-native/src/icons/Star'
import { Sun } from 'phosphor-react-native/src/icons/Sun'
import { Trash } from 'phosphor-react-native/src/icons/Trash'
import { UploadSimple } from 'phosphor-react-native/src/icons/UploadSimple'
import { UserCircle } from 'phosphor-react-native/src/icons/UserCircle'
import { UsersThree } from 'phosphor-react-native/src/icons/UsersThree'
import { Wallet } from 'phosphor-react-native/src/icons/Wallet'
import { Warning } from 'phosphor-react-native/src/icons/Warning'
import { Wrench } from 'phosphor-react-native/src/icons/Wrench'
import { X } from 'phosphor-react-native/src/icons/X'
import { XCircle } from 'phosphor-react-native/src/icons/XCircle'
import type { ComponentType } from 'react'

/** The props `phosphor-react-native` icons take that the registry passes. */
export interface PhosphorProps {
  size?: number
  color?: string
  weight?: 'regular' | 'fill' | 'bold'
}

/**
 * The typed registry of DOC-54 §7.3: exactly the names of `ICON_NAMES`, so a name outside it does not compile and a name that
 * is not mapped does not either (DS-06). A screen that needs a new icon adds it to `ICON_NAMES` first.
 */
export const ICONS: Record<IconName, ComponentType<PhosphorProps>> = {
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
  desktop: Desktop,
  sun: Sun,
  moon: Moon,
  'sidebar-simple': SidebarSimple,
}
