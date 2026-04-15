const Yamaha = require('yamaha-nodejs');
const Receiver = require('../accessories/Receiver')

const SUPPORTED_MODELS = new Set(['WXC-50', 'WXA-50'])
const NON_INPUT_FEATURE_KEYS = new Set(['Main_Zone', 'Zone_2', 'Zone_3', 'Zone_4'])
const INPUT_NAME_FALLBACKS = {
	AirPlay: 'AirPlay',
	AUX: 'AUX',
	Bluetooth: 'Bluetooth',
	Deezer: 'Deezer',
	JUKE: 'Favorites',
	Napster: 'Napster',
	'NET RADIO': 'Net Radio',
	Pandora: 'Pandora',
	Qobuz: 'Qobuz',
	SERVER: 'Server',
	SiriusXM: 'SiriusXM',
	Spotify: 'Spotify',
	TIDAL: 'TIDAL',
	TUNER: 'Tuner',
	USB: 'USB',
	'MusicCast Link': 'MusicCast Link',
	'V-AUX': 'V-AUX'
}
const MODEL_INPUT_EXTRAS = {
	'WXC-50': [
		{ key: 'AUX', name: 'AUX' }
	],
	'WXA-50': [
		{ key: 'AUX', name: 'AUX' }
	]
}

module.exports = {
	init: async function() {

		await this.storage.init({
			dir: this.persistPath,
			forgiveParseErrors: true
		})

		this.cachedDevices = await this.storage.getItem('cachedDevices') || []
		this.cachedStates = await this.storage.getItem('cachedStates') || {}

		// remove cachedDevices that were removed from config
		this.cachedDevices = this.cachedDevices.filter(cachedDevice =>
			this.receivers.find(receiver => receiver.ip === cachedDevice.ip))

		for (const config of this.receivers) {

			if (!config.ip)
				continue

			// validate ipv4
			const IPV4 = new RegExp(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)
			if (!IPV4.test(config.ip)) {
				this.log(`"${config.ip}" is not a valid IPv4 address!!`)
				this.log(`skipping "${config.ip}" device...`)
				continue
			}

			const avr = new Yamaha(config.ip)

			try {
				let systemConfig = await avr.getSystemConfig()
				systemConfig = systemConfig?.YAMAHA_AV?.System?.[0]?.Config?.[0]
				if (!systemConfig)
					throw new Error('Unexpected system config response')

				this.log.easyDebug('Got System Config:')
				this.log.easyDebug(JSON.stringify(systemConfig))
				config.id = systemConfig.System_ID[0]
				config.model = systemConfig.Model_Name[0]
				config.features = systemConfig.Feature_Existence ? systemConfig.Feature_Existence[0] : {}
				config.inputs = getConfiguredInputs(systemConfig)

				if (!SUPPORTED_MODELS.has(config.model)) {
					this.log(`Skipping unsupported device "${config.model}" at ${config.ip}`)
					continue
				}

				this.log(`Found supported device "Yamaha ${config.model}" at ${config.ip}`)
				if (!Object.keys(config.inputs).length)
					this.log.easyDebug(`${config.model} did not expose named inputs, using feature-based fallback mapping`)

			} catch(err) {
				this.log(`Could not fully detect receiver at ${config.ip}!`)
				this.log('The device responded, but its system config could not be parsed completely')
				this.log.easyDebug(err.message)
			}

			// get device from cache if exists
			let deviceConfig = this.cachedDevices.find(device => device.id === config.id || device.ip === config.ip)

			if (deviceConfig) {
				// Update dynamic config params
				const availableInputs = getInputs(config)
				deviceConfig.model = config.model || deviceConfig.model
				if (availableInputs.length)
					deviceConfig.zone1.inputs = mergeInputs(deviceConfig.zone1.inputs, availableInputs)

				deviceConfig.zone1.volume.type = config.volumeAccessory
				deviceConfig.zone1.minVolume = typeof config.minVolume === 'number' ? config.minVolume : -80
				deviceConfig.zone1.maxVolume = typeof config.maxVolume === 'number' ? config.maxVolume : -10

				for (const i of [2, 3, 4]) {
					if (deviceConfig[`zone${i}`]) {
						deviceConfig[`zone${i}`].active = config[`enableZone${i}`]
						if (availableInputs.length)
							deviceConfig[`zone${i}`].inputs = mergeInputs(deviceConfig[`zone${i}`].inputs, availableInputs, true)

						deviceConfig[`zone${i}`].minVolume = typeof config[`zone${i}MinVolume`] === 'number' ? config[`zone${i}MinVolume`] : deviceConfig.zone1.minVolume
						deviceConfig[`zone${i}`].maxVolume = typeof config[`zone${i}MaxVolume`] === 'number' ? config[`zone${i}MaxVolume`] : deviceConfig.zone1.maxVolume
						deviceConfig[`zone${i}`].volume.type = config.volumeAccessory
					}
				}
			} else {
				if (!config.id) {
					this.log(`Can't create new accessory for undetected device (${config.ip}) !`)
					this.log(`skipping "${config.ip}" device...`)
					continue
				}

				// Create config for new device
				try {
					const availableInputs = getInputs(config)
					this.log.easyDebug('Available Inputs:')
					this.log.easyDebug(availableInputs)
					deviceConfig = await createNewConfig(config, availableInputs, this.log)
					this.cachedDevices.push(deviceConfig)
				} catch(err) {
					this.log.easyDebug(err)
					continue
				}
			}

			this.log.easyDebug(`Full Device Config: ${JSON.stringify(deviceConfig)}`)
			// init avr accessories
			newAVR(avr, deviceConfig, this)
		}

		// update cachedDevices storage
		await this.storage.setItem('cachedDevices', this.cachedDevices)
	}
}

const createNewConfig = async (config, availableInputs, log) => {
	try {
		const newConfig = {
			ip: config.ip,
			id: config.id,
			model: config.model,
			zone1: {
				name: config.name,
				inputs: mapInputs(availableInputs),
				minVolume: typeof config.minVolume === 'number' ? config.minVolume : -80,
				maxVolume: typeof config.maxVolume === 'number' ? config.maxVolume : -10,
				volume: {
					name: `${config.name} Volume`,
					type: config.volumeAccessory
				},
			}
		}

		for (const i of [2, 3, 4]) {
			if (config.features?.[`Zone_${i}`] && config.features[`Zone_${i}`][0] === '1') {
				log.easyDebug(`Zone ${i} Available!`)
				newConfig[`zone${i}`] = {
					active: config[`enableZone${i}`],
					name: `${config.name} Zone${i}`,
					inputs: mapInputs(availableInputs, true),
					minVolume: typeof config[`zone${i}MinVolume`] === 'number' ? config[`zone${i}MinVolume`] : -80,
					maxVolume: typeof config[`zone${i}MaxVolume`] === 'number' ? config[`zone${i}MaxVolume`] : -10,
					volume: {
						name: `${config.name} Zone${i} Volume`,
						type: config.volumeAccessory
					}
				}
			}
		}

		return newConfig
	} catch(err) {
		log('ERROR Creating config', err.message)
		throw err
	}
}

const getZoneConfig = (config, zone) => {
	return {
		ip: config.ip,
		id: config.id,
		avrName: config.zone1.name,
		name: config[`zone${zone}`].name,
		zone: zone,
		model: config.model,
		inputs: config[`zone${zone}`].inputs,
		volume: config[`zone${zone}`].volume,
		minVolume: config[`zone${zone}`].minVolume,
		maxVolume: config[`zone${zone}`].maxVolume
	}
}

const newAVR = function(avr, deviceConfig, platform) {
	new Receiver(avr, platform, getZoneConfig(deviceConfig, 1))

	for (const i of [2, 3, 4]) {
		if (deviceConfig[`zone${i}`] && deviceConfig[`zone${i}`].active) {
			platform.log.easyDebug(`Adding Zone ${i} for ${deviceConfig.zone1.name}`)
			new Receiver(avr, platform, getZoneConfig(deviceConfig, i))
		}
	}
}

const getInputs = function(config) {
	const availableInputs = []
	const configuredInputs = config.inputs || {}
	const features = config.features || {}

	for (const key in configuredInputs) {
		availableInputs.push({
			key: syncKey(key),
			name: configuredInputs[key][0]
		})
	}

	for (const key in features) {
		const syncedKey = syncKey(key)
		const inputExists = availableInputs.find(input => input.key === syncedKey)
		if (!inputExists && !NON_INPUT_FEATURE_KEYS.has(key) && features[key][0] === '1') {
			availableInputs.push({
				key: syncedKey,
				name: getInputDisplayName(syncedKey)
			})
		}
	}

	const modelExtras = MODEL_INPUT_EXTRAS[config.model] || []
	for (const extraInput of modelExtras) {
		const inputExists = availableInputs.find(input => input.key === extraInput.key)
		if (!inputExists)
			availableInputs.push(extraInput)
	}

	return availableInputs
}

const syncKey = function(key) {
	if (key === 'NET_RADIO')
		return 'NET RADIO'

	if (key === 'MusicCast_Link')
		return 'MusicCast Link'

	if (key === 'V_AUX')
		return 'V-AUX'

	if (key === 'Tuner')
		return 'TUNER'

	return key.replace('_', '')
}

const getConfiguredInputs = function(systemConfig) {
	return systemConfig.Name?.[0]?.Input?.[0] || {}
}

const getInputDisplayName = function(key) {
	if (INPUT_NAME_FALLBACKS[key])
		return INPUT_NAME_FALLBACKS[key]

	if (/^AUDIO\d$/i.test(key))
		return `Audio ${key.slice(-1)}`

	return key
}

const mergeInputs = function(existingInputs, availableInputs, isZone) {
	const nextInputs = mapInputs(availableInputs, isZone)
	if (!Array.isArray(existingInputs))
		return nextInputs

	return nextInputs.map(input => {
		const existingInput = existingInputs.find(candidate => candidate.key === input.key)
		if (!existingInput)
			return input

		return {
			...input,
			hidden: typeof existingInput.hidden === 'number' ? existingInput.hidden : input.hidden,
			name: shouldReplaceInputName(existingInput.name, input.name) ? input.name : existingInput.name
		}
	})
}

const shouldReplaceInputName = function(existingName, fallbackName) {
	if (!existingName)
		return true

	if (existingName === fallbackName)
		return false

	return /^input(?: source)?(?: \d+)?$/i.test(existingName)
		|| /^eingabequelle(?: \d+)?$/i.test(existingName)
}

const mapInputs = function(inputs, isZone) {
	let mappedInputs = inputs.map((input, i) => {
		return { identifier: i, name: input.name, key: input.key, hidden: 0 }
	})

	if (isZone) {
		mappedInputs.unshift({ identifier: mappedInputs.length, name: 'Main Zone Sync', key: 'Main Zone Sync', hidden: 0 })
		mappedInputs = mappedInputs.filter(input => !input.key.toLowerCase().includes('hdmi'))
	}

	return mappedInputs
}
