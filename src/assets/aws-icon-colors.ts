/**
 * 同梱した AWS 公式アイコンの公式色。値は各 SVG の背景・図形の塗り色をそのまま写したもので、
 * tests/emblems.test.ts が同梱ファイルと一致することを検証する。
 * tile は公式の四角い背景を含むサービスアイコン、false は背景のない Resource アイコン。
 * 3D の立体はこの色を側面に使い、アイコン自体は改変せずに正面へ置く。
 * AWS Cloud・アカウント・リージョン・VPC・Subnet のグループアイコンは境界を表すため対象外。
 */
export const awsIconColors: Record<string, { color: string; tile: boolean }> = {
  'aws.alb': { color: '#8C4FFF', tile: true },
  'aws.beanstalk-version': { color: '#ED7100', tile: false },
  'aws.control-tower': { color: '#E7157B', tile: true },
  'aws.customer-gateway': { color: '#8C4FFF', tile: false },
  'aws.direct-connect': { color: '#8C4FFF', tile: true },
  'aws.dynamodb': { color: '#C925D1', tile: true },
  'aws.ec2': { color: '#ED7100', tile: true },
  'aws.ecs': { color: '#ED7100', tile: true },
  'aws.ecs-container': { color: '#ED7100', tile: false },
  'aws.eks-access-entry': { color: '#DD344C', tile: true },
  'aws.eks-access-policy': { color: '#DD344C', tile: true },
  'aws.eks-pod-identity-association': { color: '#DD344C', tile: true },
  'aws.iam': { color: '#DD344C', tile: true },
  'aws.identity-center': { color: '#DD344C', tile: true },
  'aws.lambda': { color: '#ED7100', tile: true },
  'aws.organization-policy': { color: '#E7157B', tile: true },
  'aws.organization-policy-attachment': { color: '#E7157B', tile: true },
  'aws.privatelink': { color: '#8C4FFF', tile: true },
  'aws.ram-principal-association': { color: '#DD344C', tile: true },
  'aws.ram-resource-association': { color: '#DD344C', tile: true },
  'aws.ram-share': { color: '#DD344C', tile: true },
  'aws.rds': { color: '#C925D1', tile: true },
  'aws.route53': { color: '#8C4FFF', tile: true },
  'aws.s3': { color: '#7AA116', tile: true },
  'aws.tgw-attachment': { color: '#8C4FFF', tile: false },
  'aws.tgw-route-association': { color: '#8C4FFF', tile: false },
  'aws.tgw-route-propagation': { color: '#8C4FFF', tile: false },
  'aws.tgw-route-table': { color: '#8C4FFF', tile: true },
  'aws.transit-gateway': { color: '#8C4FFF', tile: true },
  'aws.vpc-lattice': { color: '#8C4FFF', tile: true },
  'aws.vpn-connection': { color: '#8C4FFF', tile: true },
};
