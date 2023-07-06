import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { ClusterProps, Cluster } from "./constructs/cluster";
import { NodeGroup, NodeGroupProps } from "./constructs/nodegroup";
import { AWSLoadBalancerController, AWSLoadBalancerControllerProps } from "./constructs/awslbc"
import { ExternalDNSProps, ExternalDNS } from "./constructs/externaldns";
import { AcmCertAndValidate } from "./constructs/acmCertAndValidate";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { HelmProvider } from "@cdktf/provider-helm/lib/provider";

// Uncomment when ready for game deployment
import { Game, GameProps } from "./constructs/deployments/game";
import { TlsProvider } from "@cdktf/provider-tls/lib/provider";
import { GitHubActionsOIDC } from "./constructs/ghActionsOIDC";


class CPIEEksStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // --------------------------------------------------------------------------
    // 
    // Constants
    // 
    // --------------------------------------------------------------------------

    // Default tags for all resources
    const tags = {
      "Service": "cdktf-eks-demo",
      "Environment": "sandbox",
      "Subservice": "cdktf-demo-game-2048"
    }

    // --------------------------------------------------------------------------
    // 
    // Providers
    // 
    // --------------------------------------------------------------------------

    const awsProvider = new AwsProvider(this, "awsProvider", {
      region: "us-east-1"
    })

    const tlsProvider = new TlsProvider(this, "mainTlsProvider", {
      alias: "mainTlsProvider"
    });

    // --------------------------------------------------------------------------
    // 
    // Constructs
    // 
    // --------------------------------------------------------------------------

    // OIDC Provider for GitHub Actions

    new GitHubActionsOIDC(this, "cdktf-dylan-eks-ghactions-oidc", {
      awsProvider: awsProvider,
      tlsProvider: tlsProvider,
      githubRepositoryDetails: {
        owner: "Schlags",
        name: "cdktf-eks"
      },
      tags: tags
    });

    // ACM Certificate

    const acmCertValidatation: AcmCertAndValidate = new AcmCertAndValidate(this, "cdktf-dylan-eks-acmcert", {
      awsProvider: awsProvider,
      domainPath: "cdktf.dylanschlager.com",
    });


    // EKS Cluster and Node Groups
    const clusterProps: ClusterProps = {
      region: "us-east-1",
      clusterName: "cdktf-dylan-eks-cluster",
      s3Backend: true,
      s3Bucket: "cdktf-dylan-eks-cluster-cdktf",
      s3Key: "cdktf-dylan-eks-cluster.tfstate",
      awsProvider: awsProvider,
      tags: tags
    }

    const cluster = new Cluster(this, "cdktf-dylan-eks-cluster", clusterProps);
    
    const nodegroupProps: NodeGroupProps = {
      clusterName: cluster.clusterName,
      subnets: cluster.privateSubnets,
      dependsOn: [cluster.cluster],
      nodeScalingConfig: {
        desiredCapacity: 1,
      },
      tags: tags
    }

    new NodeGroup(this, "cdktf-dylan-eks-nodegroup", nodegroupProps);

    // Define k8s provider created in Cluster construct as constant to be used in other constructs
    const k8sprovider: KubernetesProvider = cluster.k8sProvider as KubernetesProvider;
    console.log(`Got k8s provider alias: ${k8sprovider.alias}`);

    // Define helm provider from k8s provider
    const helmProvider = new HelmProvider(this, 'HelmProvider', {
        kubernetes: {
            host: k8sprovider.host,
            clusterCaCertificate: k8sprovider.clusterCaCertificate,
            exec: {
                apiVersion: 'client.authentication.k8s.io/v1beta1',
                args: ["eks", "get-token", "--cluster-name", cluster.cluster.name],
                command: 'aws',
            },
            // TODO: investigate why 509 error is thrown when using token
            insecure: true
        },
    });

    // AWS Load Balancer Controller and External DNS
    const awslbcProps: AWSLoadBalancerControllerProps = {
      k8sProvider: k8sprovider,
      helmProvider: helmProvider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider,
      domainPath: acmCertValidatation.domainPath,
      tags: tags
    };

    new AWSLoadBalancerController(this, "cdktf-dylan-eks-awslbc", awslbcProps);

    const externalDNSProps: ExternalDNSProps = {
      k8sProvider: k8sprovider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider,
      hostedZoneName: acmCertValidatation.domainPath,
      tags: tags
    }

    new ExternalDNS(this, "cdktf-dylan-eks-externaldns", externalDNSProps);


    // Put game definition here!
    const gameProps: GameProps = {
      k8sProvider: k8sprovider,
      domainPath: `${acmCertValidatation.domainPath}`,
      subdomain: 'game',
      certificateArn: acmCertValidatation.acmCertificate.arn
    }
    new Game(this, "cdktf-dylan-eks-game", gameProps);
  }
}

const app = new App();
new CPIEEksStack(app, "cdktf-eks");
app.synth();
