export type NoticeSection='running'|'scheduled'|'series'|'history'
export type NotificationStatus='SCHEDULED'|'AVAILABLE'|'CANCELLED'|'EXPIRED'
export type FcmStatus='PENDING'|'SENDING'|'SENT'|'RETRY'|'FAILED'|'UNKNOWN'|'SKIPPED'
export interface NoticeForView {
 status:NotificationStatus
 pushStatus?:FcmStatus
}
export const notificationSections:ReadonlyArray<{
 id:NoticeSection
 label:string
 description:string
}>
export function groupNotifications<T extends NoticeForView>(items:readonly T[]):{
 running:T[]
 scheduled:T[]
 history:T[]
}
