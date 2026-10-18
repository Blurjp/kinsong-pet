Pod::Spec.new do |s|
  s.name           = 'PetCutout'
  s.version        = '0.1.0'
  s.summary        = 'Cuts the pet out of a short video, on the device.'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Kinsong'
  s.homepage       = 'https://github.com/Blurjp/kinsong-pet'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
