import {
  BlockfrostProvider,
  CIP68_100,
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

async function awaitCollateral(
  wallet: MeshWallet,
  maxRetries: number = 10,
): Promise<UTxO | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const [collateral] = await wallet.getCollateral();

    if (collateral) {
      return collateral;
    }

    console.log(`Attempt ${attempt}: No collateral yet. Retrying...`);
    await wallet.createCollateral();
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
let collateral: UTxO | null = await awaitCollateral(wallet, 10);

if (collateral === null) {
  throw "Collateral not found";
}

const changeAddress = wallet.getChangeAddress();
const pubKeyHash = deserializeAddress(changeAddress).pubKeyHash;

const validatorsArray = validator.validators;
const editCBOR = applyParamsToScript(validatorsArray[3]?.compiledCode!, [
  pubKeyHash,
]);

const script: PlutusScript = {
  code: editCBOR,
  version: "V3",
};
const { address: scriptAddress } = serializePlutusScript(script);

const policyId = resolveScriptHash(editCBOR, "V3");
const tokenName = argv.t;
const tokenNameHex = stringToHex(tokenName);
const refTokenName = CIP68_100(tokenNameHex);
const refTokenUnit = policyId + refTokenName;
const userTokenMetadata = {
  name: tokenName,
  image: "ipfs://QmRzicpReutwCkM6aotuKjErFCUD213DpwPq6ByuzMJaua",
  mediaType: "image/jpg",
  description: "Changed Metadata",
};

const assetUtxo = await provider.fetchAddressUTxOs(scriptAddress, refTokenUnit);

if (assetUtxo === undefined) {
  throw "Asset UTXO not found";
}

const redeemer = mConStr(2, []);

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
  .txInScript(editCBOR)
  .txOut(scriptAddress, [{ unit: policyId + refTokenName, quantity: "1" }])
  .txOutInlineDatumValue(metadataToCip68(userTokenMetadata))
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
