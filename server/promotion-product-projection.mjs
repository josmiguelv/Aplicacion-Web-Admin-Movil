// Pure catalogue projection: preserve product and promotion field contracts.
export function indexedPromotionProducts(products, promotions) {
 const byId = new Map(products.map(product => [product.id, product]))
 return promotions.map(promotion => {
  const product = byId.get(promotion.productId)
  return {
   ...promotion,
   productId: product?.id ?? promotion.productId ?? null,
   product: product ? {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    pricePen: Number(product.price_pen),
    imageUrl: product.image_url
   } : null
  }
 }).filter(promotion => promotion.productId === null || promotion.product !== null)
}
