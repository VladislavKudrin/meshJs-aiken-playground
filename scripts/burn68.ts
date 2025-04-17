import {
  BlockfrostProvider,
  CIP68_100,
  CIP68_222,
  deserializeAddress,
  mConStr,
  MeshTxBuilder,
  MeshWallet,
  metadataToCip68,
  resolveScriptHash,
  serializePlutusScript,
  stringToHex,
  type PlutusScript,
  type UTxO,
} from "@meshsdk/core";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import validator from "../static/plutus.json";
import { applyParamsToScript } from "@meshsdk/core-csl";

async function awaitCollateral(maxRetries = 10): Promise<UTxO | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const [collateral] = await wallet.getCollateral();

    if (collateral) {
      return collateral;
    }

    console.log(`Attempt ${attempt}: No collateral yet. Retrying...`);
    await new Promise((res) => setTimeout(res, 5000));
  }

  console.warn("Max retries reached. No collateral found.");
  return null;
}

const argv = await yargs(hideBin(process.argv))
  .option("t", {
    type: "string",
    describe: "Your token",
    default: "TEST",
  })
  .parse();
const provider = new BlockfrostProvider(process.env.BLOCKFROST_PROJECT_ID!);
const MNEMONIC = process.env.MNEMONIC!;

const wallet = new MeshWallet({
  networkId: 0, // 0: testnet, 1: mainnet
  fetcher: provider,
  submitter: provider,
  key: {
    type: "mnemonic",
    words: MNEMONIC.split(" "),
  },
});

const utxos = await wallet.getUtxos();
let collateral: UTxO | null = await awaitCollateral(10);

if (collateral === null) {
  throw "Collateral not found";
}

const changeAddress = wallet.getChangeAddress();
const pubKeyHash = deserializeAddress(changeAddress).pubKeyHash;

const validatorsArray = validator.validators;
const spendCBOR = applyParamsToScript(validatorsArray[3]?.compiledCode!, [
  pubKeyHash,
]);

const script: PlutusScript = {
  code: spendCBOR,
  version: "V3",
};
const { address: scriptAddress } = serializePlutusScript(script);

const policyId = resolveScriptHash(spendCBOR, "V3");
const tokenName = argv.t;
const tokenNameHex = stringToHex(tokenName);
const refTokenName = CIP68_100(tokenNameHex);
const userTokenName = CIP68_222(tokenNameHex);
const refTokenUnit = policyId + refTokenName;

const assetUtxo = await provider.fetchAddressUTxOs(scriptAddress, refTokenUnit);

if (assetUtxo === undefined) {
  throw "Asset UTXO not found";
}

const redeemer = mConStr(1, []);

const txBuilder = new MeshTxBuilder({
  fetcher: provider,
  verbose: true,
});

const unsignedTx = await txBuilder
  .txIn(
    utxos[0]?.input.txHash!,
    utxos[0]?.input.outputIndex!,
    utxos[0]?.output.amount!,
    utxos[0]?.output.address!,
  )
  .spendingPlutusScriptV3()
  .txIn(assetUtxo[0]?.input.txHash!, assetUtxo[0]?.input.outputIndex!)
  .txInInlineDatumPresent()
  .txInRedeemerValue(redeemer)
  .txInScript(spendCBOR)
  .mintPlutusScriptV3()
  .mint("-1", policyId, refTokenName)
  .mintingScript(spendCBOR)
  .mintRedeemerValue(redeemer)
  .mintPlutusScriptV3()
  .mint("-1", policyId, userTokenName)
  .mintingScript(spendCBOR)
  .mintRedeemerValue(redeemer)
  .requiredSignerHash(pubKeyHash)
  .changeAddress(changeAddress)
  .selectUtxosFrom(utxos)
  .txInCollateral(
    collateral.input.txHash,
    collateral.input.outputIndex,
    collateral.output.amount,
    collateral.output.address,
  )
  .setNetwork("preprod")
  .complete();

const signedTx = await wallet.signTx(unsignedTx, true);
const txHash = await wallet.submitTx(signedTx);

console.log(txHash);
