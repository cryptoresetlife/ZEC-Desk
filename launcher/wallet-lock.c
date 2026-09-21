// Hold a kernel advisory lock across exec. No stale PID files, shell, or secret output.
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#include <errno.h>
int main(int argc,char **argv){
  if(argc!=4)return 47;
  umask(077);
  char lock[PATH_MAX],wallet[PATH_MAX];
  if(snprintf(lock,sizeof(lock),"%s/zec-desk.lock",argv[1])>=(int)sizeof(lock)||
     snprintf(wallet,sizeof(wallet),"%s/zingo-wallet.dat",argv[1])>=(int)sizeof(wallet))return 47;
  int fd=open(lock,O_CREAT|O_RDWR|O_NOFOLLOW,0600);
  if(fd<0)return 47;
  if(flock(fd,LOCK_EX|LOCK_NB)<0)return 45;
  struct stat s;int present=lstat(wallet,&s)==0;
  if(!present&&errno!=ENOENT)return 47;
  if(strcmp(argv[2],"create")==0){if(present)return 46;}
  else if(strcmp(argv[2],"open")==0){if(!present)return 44;if(!S_ISREG(s.st_mode))return 47;}
  else return 47;
  // fd intentionally survives exec and is released by the kernel on exit.
  execl(argv[3],argv[3],"--data-dir",argv[1],"--chain","mainnet","--server","https://zec.rocks:443","--desk-stdio",(char*)NULL);
  return 47;
}
