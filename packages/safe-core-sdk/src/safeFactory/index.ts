import {
  EthAdapter,
  GnosisSafeContract,
  GnosisSafeProxyFactoryContract,
  SafeVersion,
  TransactionOptions
} from '@gnosis.pm/safe-core-sdk-types'
import { SAFE_LAST_VERSION } from '../contracts/config'
import {
  getSafeContractDeployment,
  getSafeProxyFactoryContractDeployment
} from '../contracts/safeDeploymentContracts'
import Safe from '../Safe'
import { ContractNetworkConfig, ContractNetworksConfig } from '../types'
import { EMPTY_DATA, ZERO_ADDRESS } from '../utils/constants'
import { validateSafeAccountConfig } from './utils'

export interface SafeAccountConfig {
  owners: string[]
  threshold: number
  to?: string
  data?: string
  fallbackHandler?: string
  paymentToken?: string
  payment?: number
  paymentReceiver?: string
}

export interface SafeDeploymentConfig {
  saltNonce: number
}

export interface DeploySafeProps {
  safeAccountConfig: SafeAccountConfig
  safeDeploymentConfig?: SafeDeploymentConfig
  options?: TransactionOptions
}

export interface SafeFactoryConfig {
  /** ethAdapter - Ethereum adapter */
  ethAdapter: EthAdapter
  /** safeVersion - Versions of the Safe deployed by this Factory contract */
  safeVersion?: SafeVersion
  /** isL1SafeMasterCopy - Forces to use the Gnosis Safe L1 version of the contract instead of the L2 version */
  isL1SafeMasterCopy?: boolean
  /** contractNetworks - Contract network configuration */
  contractNetworks?: ContractNetworksConfig
}

interface SafeFactoryInitConfig {
  /** ethAdapter - Ethereum adapter */
  ethAdapter: EthAdapter
  /** safeVersion - Versions of the Safe deployed by this Factory contract */
  safeVersion: SafeVersion
  /** isL1SafeMasterCopy - Forces to use the Gnosis Safe L1 version of the contract instead of the L2 version */
  isL1SafeMasterCopy?: boolean
  /** contractNetworks - Contract network configuration */
  contractNetworks?: ContractNetworksConfig
}

interface GetSafeContractInstanceProps {
  ethAdapter: EthAdapter
  safeVersion: SafeVersion
  chainId: number
  isL1SafeMasterCopy?: boolean
  customContracts?: ContractNetworkConfig
}

interface GetProxyFactoryContractInstanceProps {
  ethAdapter: EthAdapter
  safeVersion: SafeVersion
  chainId: number
  customContracts?: ContractNetworkConfig
}

class SafeFactory {
  #contractNetworks?: ContractNetworksConfig
  #isL1SafeMasterCopy?: boolean
  #safeVersion!: SafeVersion
  #ethAdapter!: EthAdapter
  #safeProxyFactoryContract!: GnosisSafeProxyFactoryContract
  #gnosisSafeContract!: GnosisSafeContract

  static async create({
    ethAdapter,
    safeVersion = SAFE_LAST_VERSION,
    isL1SafeMasterCopy = false,
    contractNetworks
  }: SafeFactoryConfig): Promise<SafeFactory> {
    const safeFactorySdk = new SafeFactory()
    await safeFactorySdk.init({ ethAdapter, safeVersion, isL1SafeMasterCopy, contractNetworks })
    return safeFactorySdk
  }

  private async init({
    ethAdapter,
    safeVersion,
    isL1SafeMasterCopy,
    contractNetworks
  }: SafeFactoryInitConfig): Promise<void> {
    this.#ethAdapter = ethAdapter
    this.#safeVersion = safeVersion
    this.#isL1SafeMasterCopy = isL1SafeMasterCopy
    this.#contractNetworks = contractNetworks
    const chainId = await this.#ethAdapter.getChainId()
    const customContracts = contractNetworks?.[chainId]
    this.#safeProxyFactoryContract = await this.getProxyFactoryContract({
      ethAdapter,
      safeVersion,
      chainId,
      customContracts
    })
    this.#gnosisSafeContract = await this.getSafeContract({
      ethAdapter,
      safeVersion,
      chainId,
      isL1SafeMasterCopy,
      customContracts
    })
  }

  getEthAdapter(): EthAdapter {
    return this.#ethAdapter
  }

  getSafeVersion(): SafeVersion {
    return this.#safeVersion
  }

  getAddress(): string {
    return this.#safeProxyFactoryContract.getAddress()
  }

  async getChainId(): Promise<number> {
    return this.#ethAdapter.getChainId()
  }

  private async encodeSetupCallData({
    owners,
    threshold,
    to = ZERO_ADDRESS,
    data = EMPTY_DATA,
    fallbackHandler = ZERO_ADDRESS,
    paymentToken = ZERO_ADDRESS,
    payment = 0,
    paymentReceiver = ZERO_ADDRESS
  }: SafeAccountConfig): Promise<string> {
    return this.#gnosisSafeContract.encode('setup', [
      owners,
      threshold,
      to,
      data,
      fallbackHandler,
      paymentToken,
      payment,
      paymentReceiver
    ])
  }

  async deploySafe({
    safeAccountConfig,
    safeDeploymentConfig,
    options
  }: DeploySafeProps): Promise<Safe> {
    validateSafeAccountConfig(safeAccountConfig)
    const signerAddress = await this.#ethAdapter.getSignerAddress()
    const initializer = await this.encodeSetupCallData(safeAccountConfig)
    const saltNonce =
      safeDeploymentConfig?.saltNonce ?? Date.now() * 1000 + Math.floor(Math.random() * 1000)

    if (options?.gas && options?.gasLimit) {
      throw new Error('Cannot specify gas and gasLimit together in transaction options')
    }
    const safeAddress = await this.#safeProxyFactoryContract.createProxy({
      safeMasterCopyAddress: this.#gnosisSafeContract.getAddress(),
      initializer,
      saltNonce,
      options: {
        from: signerAddress,
        ...options
      }
    })
    const isContractDeployed = await this.#ethAdapter.isContractDeployed(safeAddress)
    if (!isContractDeployed) {
      throw new Error('Safe Proxy contract is not deployed in the current network')
    }
    const safe = await Safe.create({
      ethAdapter: this.#ethAdapter,
      safeAddress,
      isL1SafeMasterCopy: this.#isL1SafeMasterCopy,
      contractNetworks: this.#contractNetworks
    })
    return safe
  }

  private async getSafeContract({
    ethAdapter,
    safeVersion,
    chainId,
    isL1SafeMasterCopy,
    customContracts
  }: GetSafeContractInstanceProps): Promise<GnosisSafeContract> {
    const safeSingletonDeployment = getSafeContractDeployment(
      SAFE_LAST_VERSION,
      chainId,
      isL1SafeMasterCopy
    )
    const gnosisSafeContract = ethAdapter.getSafeContract({
      safeVersion: safeVersion,
      chainId,
      singletonDeployment: safeSingletonDeployment,
      customContractAddress: customContracts?.safeMasterCopyAddress,
      customContractAbi: customContracts?.safeMasterCopyAbi
    })
    const isContractDeployed = await this.#ethAdapter.isContractDeployed(
      gnosisSafeContract.getAddress()
    )
    if (!isContractDeployed) {
      throw new Error('Safe Proxy contract is not deployed in the current network')
    }
    return gnosisSafeContract
  }

  private async getProxyFactoryContract({
    ethAdapter,
    safeVersion,
    chainId,
    customContracts
  }: GetProxyFactoryContractInstanceProps): Promise<GnosisSafeProxyFactoryContract> {
    const proxyFactoryDeployment = getSafeProxyFactoryContractDeployment(safeVersion, chainId)
    const safeProxyFactoryContract = await ethAdapter.getSafeProxyFactoryContract({
      safeVersion: safeVersion,
      chainId,
      singletonDeployment: proxyFactoryDeployment,
      customContractAddress: customContracts?.safeProxyFactoryAddress,
      customContractAbi: customContracts?.safeProxyFactoryAbi
    })
    const isContractDeployed = await this.#ethAdapter.isContractDeployed(
      safeProxyFactoryContract.getAddress()
    )
    if (!isContractDeployed) {
      throw new Error('Safe Proxy Factory contract is not deployed in the current network')
    }
    return safeProxyFactoryContract
  }
}

export default SafeFactory
