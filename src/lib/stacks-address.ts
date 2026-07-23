import * as P from 'micro-packed';
import { createAddress, addressToString, AddressVersion, StacksWireType } from '@stacks/transactions';
import { hex } from '@scure/base';
import { type Hex, pad, toHex } from "viem";

// Coder for Stacks address to bytes32 conversion
export const remoteRecipientCoder = P.wrap<string>({
  encodeStream(w, value: string) {
    const address = createAddress(value);
    P.bytes(11).encodeStream(w, new Uint8Array(11).fill(0));
    P.U8.encodeStream(w, address.version);
    P.bytes(20).encodeStream(w, hex.decode(address.hash160));
  },
  decodeStream(r) {
    P.bytes(11).decodeStream(r);
    const version = P.U8.decodeStream(r);
    const hash = P.bytes(20).decodeStream(r);
    return addressToString({
      hash160: hex.encode(hash),
      version: version as AddressVersion,
      type: StacksWireType.Address,
    });
  },
});

export function bytes32FromBytes(bytes: Uint8Array): Hex {
  return toHex(pad(bytes, { size: 32 }));
}

export function encodeStacksAddress(stacksAddress: string): Hex {
  return bytes32FromBytes(remoteRecipientCoder.encode(stacksAddress));
}

export function isValidStacksAddress(address: string): boolean {
  try {
    // Mainnet Stacks addresses start with SP. Testnet addresses (ST) are
    // deliberately rejected here - accepting one as a mainnet recipient
    // would mean funds sent to an address that doesn't exist on this
    // network.
    if (!address.match(/^SP[0-9A-Z]{33,}$/i)) {
      return false;
    }
    createAddress(address);
    return true;
  } catch {
    return false;
  }
}
