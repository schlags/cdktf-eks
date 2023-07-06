export enum WhitelistPatAddresses {
    HOME_INTERNET = "32.32.32.32/32",
}
  
export namespace WhitelistPatAddresses {
    export function asArray(): string[] {
      return Object.values(WhitelistPatAddresses).filter(
        (value) => typeof value === "string"
      ) as string[];
    }
    export function asAnnotationStringList(): string {
      return asArray().join(",");
    }
}