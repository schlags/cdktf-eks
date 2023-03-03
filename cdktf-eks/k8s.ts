import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import * as k8s from "@cdktf/provider-kubernetes"
import { Construct } from "constructs";

export interface KubernetesProps {
    readonly provider: KubernetesProvider;
    readonly clusterName: string;
    readonly createDeployment?: boolean;
    readonly image?: string; 
}

export class Kubernetes extends Construct {
    readonly provider: KubernetesProvider;
    readonly clusterName: string;
    constructor(scope: Construct, id: string, props: KubernetesProps) {
        super(scope, id);
        this.provider = props.provider;
        this.clusterName = props.clusterName;

        if (props.createDeployment) {
            new k8s.ingressV1.IngressV1(this, 'NginxIngress', {
                provider: this.provider,
                metadata: {
                    name: 'nginx-ingress',
                    labels: {
                        app: 'nginx',
                        project: this.clusterName
                    }
                },
                spec: {
                    rule: [
                        {
                            host: 'localhost',
                            http: {
                                path: [
                                    {
                                        path: '/',
                                        backend: {
                                            service: {
                                                name: 'nginx-service',
                                                port: {
                                                    number: 80
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
            new k8s.service.Service(this, 'NginxService', {
                provider: this.provider,
                metadata: {
                    name: 'nginx-service',
                    labels: {
                        app: 'nginx',
                        project: this.clusterName
                    }
                },
                spec: {
                    selector: {
                        app: 'nginx',
                        project: this.clusterName
                    },
                    type: 'NodePort',
                    port: [
                        {
                            port: 80,
                            targetPort: '80',
                            nodePort: 30001
                        }
                    ]
                }
            });
            const nginxConfMap = new k8s.configMap.ConfigMap(this, 'NginxConfigMap', {
                provider: this.provider,
                metadata: {
                    name: 'nginx-configmap',
                    labels: {
                        app: 'nginx',
                        project: this.clusterName
                    }
                },
                data: {
                    'nginx.conf': `
                    events {
                    }
                    http {
                       server {
                           listen 80;
                           location / {
                               return 200 "Hello world!";
                           }
                       }
                    }
                    `
                }
            });
            new k8s.deployment.Deployment(this, 'NginxDeployment', {
                provider: this.provider,
                waitForRollout: true,
                metadata: {
                    name: 'nginx-deployment',
                    labels: {
                        app: 'nginx',
                        project: this.clusterName
                    }
                },
                spec: {
                    replicas: "1",
                    selector: {
                        matchLabels: {
                            app: 'nginx',
                            project: this.clusterName
                        }
                    },
                    template: {
                        metadata: {
                            labels: {
                                app: 'nginx',
                                project: this.clusterName
                            }
                        },
                        spec: {
                            container: [
                                {
                                    name: 'nginx-container',
                                    image: props.image ?? 'nginx:1.14.2',
                                    port: [
                                        {
                                            containerPort: 80,
                                            name: 'web'
                                        }
                                    ],
                                    volumeMount: [
                                        {
                                            name: 'config-vol',
                                            mountPath: '/etc/nginx/'
                                        }
                                    ],
                                    livenessProbe: {
                                        httpGet: {
                                            path: '/',
                                            port: 'web'
                                        },
                                    }
                                }
                            ],
                            volume: [
                                {
                                    name: 'config-vol',
                                    configMap: {
                                        name: nginxConfMap.metadata.name,
                                        items: [
                                            {
                                                key: 'nginx.conf',
                                                path: 'nginx.conf'
                                            }
                                        ]
                                    },
                                }
                            ]
                        }
                    },
                }
            });
        }

    }
}