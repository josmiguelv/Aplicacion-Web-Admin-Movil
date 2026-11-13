export type Role = 'company' | 'super'

export type Product = {
  id: string
  name: string
  description: string
  category: string
  price: number
  available: boolean
  imageUrl?: string
}

export type Promotion = {
  id: string
  name: string
  kind: string
  startsAt: string
  endsAt: string
  channels: string[]
  status: 'Borrador' | 'Programada'
}

export type Channel = {
  id: string
  name: string
  detail: string
  enabled: boolean
}

export type AppRegistration = {
  id: string
  name: string
  platform: 'Android' | 'iOS'
  packageId: string
  channel: string
}

export type TenantSummary = {
  id: string
  name: string
  location: string
}