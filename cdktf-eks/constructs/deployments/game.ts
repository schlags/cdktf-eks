import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { Construct } from "constructs";
import * as k8s from "@cdktf/provider-kubernetes"
import { TerraformOutput } from "cdktf";
import { WhitelistPatAddresses } from "../../core/whitelistPATAddresses";

export interface GameProps {
    readonly k8sProvider: KubernetesProvider;
    readonly domainPath: string;
    readonly subdomain: string;
    readonly certificateArn: string;
}

export class Game extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly hostName: string;
    readonly certificateArn: string;

    constructor(scope: Construct, id: string, props: GameProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.hostName = `${props.subdomain}.${props.domainPath}`;
        this.certificateArn = props.certificateArn;

        new k8s.namespace.Namespace(this, "game", {
            provider: this.k8sProvider,
            metadata: {
                name: "game-2048"
            }
        });

        new k8s.deployment.Deployment(this, "game-deployment", {
            provider: this.k8sProvider,
            metadata: {
                name: "deployment-2048",
                namespace: "game-2048"
            },
            spec: {
                selector: {
                    matchLabels: {
                        'app.kubernetes.io/name': 'app-2048',
                    },
                },
                replicas: '5',
                template: {
                    metadata: {
                        labels: {
                            'app.kubernetes.io/name': 'app-2048',
                        }
                    },
                    spec: {
                        container: [
                            {
                                name: "app-2048",
                                image: "public.ecr.aws/l6m2t8p7/docker-2048:latest",
                                port: [
                                    {
                                        containerPort: 80,
                                    }
                                ]
                            }
                        ]
                    }
                },
            }
        });
        new k8s.service.Service(this, "game-service", {
            provider: this.k8sProvider,
            metadata: {
                name: "service-2048",
                namespace: "game-2048"
            },
            spec: {
                selector: {
                    'app.kubernetes.io/name': 'app-2048',
                },
                port: [
                    {
                        port: 80,
                        targetPort: '80',
                        protocol: "TCP",
                    }
                ],
                type: "NodePort",
            }
        });

        new k8s.ingressV1.IngressV1(this, "game-ingress", {
            provider: this.k8sProvider,
            metadata: {
                name: "ingress-2048",
                namespace: "game-2048",
                annotations: {
                    "alb.ingress.kubernetes.io/certificate-arn": this.certificateArn,
                    "alb.ingress.kubernetes.io/target-type": "ip",
                    "alb.ingress.kubernetes.io/scheme": "internet-facing",
                    "alb.ingress.kubernetes.io/inbound-cidrs": WhitelistPatAddresses.asAnnotationStringList(),
                    "external-dns.alpha.kubernetes.io/hostname": this.hostName,
                },
            },
            spec: {
                ingressClassName: "alb",
                rule: [
                    {
                        http: {
                            path: [
                                {
                                    path: "/",
                                    pathType: "Prefix",
                                    backend: {
                                        service: {
                                            name: "service-2048",
                                            port: {
                                                number: 80,
                                            }
                                        }
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        });

        new TerraformOutput(this, "game-url", {
            value: `https://${this.hostName}`
        });
    }
}