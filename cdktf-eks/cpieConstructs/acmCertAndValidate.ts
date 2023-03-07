import { Construct } from "constructs";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { AcmCertificate } from "@cdktf/provider-aws/lib/acm-certificate";
import { DataAwsRoute53Zone } from "@cdktf/provider-aws/lib/data-aws-route53-zone";
import { Route53Record } from "@cdktf/provider-aws/lib/route53-record";
import { TerraformOutput } from "cdktf";

export interface AcmCertAndValidateProps {
    readonly awsProvider: AwsProvider;
    readonly domainPath: string;
    readonly tags?: {[key: string]: string};
}


export class AcmCertAndValidate extends Construct {
    readonly awsProvider: AwsProvider;
    readonly domainPath: string;
    readonly tags: {[key: string]: string};
    readonly acmCertificate: AcmCertificate;

    constructor(scope: Construct, id: string, props: AcmCertAndValidateProps) {
        super(scope, id);
        this.awsProvider = props.awsProvider;
        this.domainPath = props.domainPath;
        this.tags = props.tags ?? {};

        // Create the ACM certificate


        this.acmCertificate = new AcmCertificate(this, 'ACMCertificate', {
            domainName: `${this.domainPath}`,
            subjectAlternativeNames: [`*.${this.domainPath}`],
            validationMethod: 'DNS',
            tags: this.tags
        });

        // Create the DNS record for the ACM certificate validation
        const dataHostedZone = new DataAwsRoute53Zone(this, 'HostedZone', {
            name: this.domainPath,
            provider: this.awsProvider
        });

        new Route53Record(this, 'ACMCertificateValidationRecord', {
            name: this.acmCertificate.domainValidationOptions.get(0).resourceRecordName,
            type: this.acmCertificate.domainValidationOptions.get(0).resourceRecordType,
            zoneId: dataHostedZone.id,
            ttl: 60,
            records: [this.acmCertificate.domainValidationOptions.get(0).resourceRecordValue],
        });

        new TerraformOutput(this, 'ACMCertificateArn', {
            value: this.acmCertificate.arn
        });
    }
}