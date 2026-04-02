require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'TmzLaunchMap'
  s.version          = package['version']
  s.summary          = 'Local Expo module for native launch map rendering.'
  s.description      = 'Native MapKit launch map rendering for FAA advisory overlays and pad satellite previews.'
  s.license          = 'Proprietary'
  s.author           = 'T-Minus Zero'
  s.homepage         = 'https://tminuszero.app'
  s.platforms        = {
    :ios => '15.1'
  }
  s.swift_version    = '5.9'
  s.source           = { git: 'https://github.com/expo/expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
