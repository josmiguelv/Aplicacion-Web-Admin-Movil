export function verifyStoredOrderAvailability<T extends {id:string;consult_order_availability?:boolean}>(
 saved:{id:string;consult_order_availability?:boolean},
 rows:readonly T[],
 expected:boolean
):T
