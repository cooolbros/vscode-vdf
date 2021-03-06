
@REM Build Shared VDF first
cd shared/VDF
rm -f tsconfig.tsbuildinfo
rm -rf dist
call tsc -b
cd ../..

wt new-tab --profile "Command Prompt" --title "Client"                         -d client                cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "HUD Animations Language Server" -d servers/hudanimations cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "VDF Language Server"            -d servers/vdf           cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "Popfile Language Server"        -d servers/popfile       cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "Shared HUD Animations"          -d shared/hudanimations  cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "Shared Tools"                   -d shared/tools          cmd /c tsc -b -w ; ^
   new-tab --profile "Command Prompt" --title "Shared VDF"                     -d shared/VDF            cmd /c tsc -b -w
